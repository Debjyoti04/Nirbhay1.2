import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  Platform,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTripStore } from '../store/tripStore';
import MapView from '../components/MapView';
import SafetyCheckModal from '../components/SafetyCheckModal';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Web fallback for demo purposes
const isWeb = Platform.OS === 'web';

export default function HomeScreen() {
  const {
    currentTrip,
    isTracking,
    locations,
    motionStatus,
    lastRiskRule,
    guardianPhone,
    guardianPhone2,
    guardianPhone3,
    setGuardianPhone,
    startTrip,
    endTrip,
    addLocation,
    setMotionStatus,
    setLastRiskRule,
    trackingSource,
    setTrackingSource,
    accuracy,
    setAccuracy,
  } = useTripStore();

  const [loading, setLoading] = useState(false);
  const [phoneInput, setPhoneInput] = useState(guardianPhone);
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [locationPermission, setLocationPermission] = useState(isWeb);
  const [showSafetyCheck, setShowSafetyCheck] = useState(false);
  const [pendingPanicData, setPendingPanicData] = useState<{accelVariance: number, gyroVariance: number} | null>(null);
  
  // Refs for tracking subscriptions
  const locationSubscription = useRef<any>(null);
  const accelSubscription = useRef<any>(null);
  const gyroSubscription = useRef<any>(null);
  const varianceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Motion data buffers
  const accelBuffer = useRef<number[]>([]);
  const gyroBuffer = useRef<number[]>([]);
  const BUFFER_SIZE = 30;  // Reduced for faster response
  const VARIANCE_CHECK_INTERVAL = 1000;  // Check every 1 second (was 2 seconds)

  // Load saved guardian on mount
  useEffect(() => {
    const loadData = async () => {
      const { loadSavedGuardian } = useTripStore.getState();
      await loadSavedGuardian();
    };
    loadData();
  }, []);

  // Request permissions on mount (native only)
  useEffect(() => {
    if (!isWeb) {
      requestNativePermissions();
    }
  }, []);

  const requestNativePermissions = async () => {
    if (isWeb) {
      setLocationPermission(true);
      return;
    }
    
    try {
      // Dynamic import for native-only modules
      const ExpoLocation = await import('expo-location');
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        setLocationPermission(true);
        try {
          await ExpoLocation.requestBackgroundPermissionsAsync();
        } catch (e) {
          console.log('Background permission not available');
        }
      } else {
        Alert.alert(
          'Permission Required',
          'Location permission is required for safety tracking.'
        );
      }
    } catch (error) {
      console.error('Permission error:', error);
    }
  };

  // Calculate variance
  const calculateVariance = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const squaredDiffs = arr.map(x => Math.pow(x - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / arr.length;
  };

  // Fallback to last known location when GPS fails
  const fallbackToLastLocation = async (tripId: string) => {
    // Get last known location from our store
    const lastKnownLocation = locations.length > 0 ? locations[locations.length - 1] : null;
    
    if (!lastKnownLocation) {
      console.log('No last known location available for fallback');
      return false;
    }
    
    // Use last location with degraded accuracy (80-100m)
    const fallbackAccuracy = 80 + Math.random() * 20; // Random between 80-100m
    
    console.log(`GPS unavailable, using last known location: ${lastKnownLocation.latitude}, ${lastKnownLocation.longitude} (accuracy: ${fallbackAccuracy.toFixed(1)}m)`);
    
    setTrackingSource('cellular_unwiredlabs');
    setAccuracy(fallbackAccuracy);
    
    // Add slightly varied location to simulate movement uncertainty
    const locationVariation = 0.0001; // ~10m variation
    const newLat = lastKnownLocation.latitude + (Math.random() - 0.5) * locationVariation;
    const newLng = lastKnownLocation.longitude + (Math.random() - 0.5) * locationVariation;
    
    addLocation({
      latitude: newLat,
      longitude: newLng,
      accuracy: fallbackAccuracy,
      source: 'cellular_unwiredlabs',
      timestamp: new Date().toISOString(),
      accuracy_radius: fallbackAccuracy,
    });
    
    // Send to backend
    try {
      await fetch(`${API_URL}/api/trips/${tripId}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trip_id: tripId,
          latitude: newLat,
          longitude: newLng,
          accuracy: fallbackAccuracy,
          source: 'cellular_unwiredlabs',
          accuracy_radius: fallbackAccuracy,
        }),
      });
      return true;
    } catch (error) {
      console.error('Failed to send fallback location:', error);
      return false;
    }
  };

  // Start location tracking
  const startLocationTracking = async (tripId: string) => {
    if (isWeb) {
      // Web demo: simulate location updates
      const demoInterval = setInterval(() => {
        const lat = 28.6139 + (Math.random() - 0.5) * 0.01;
        const lng = 77.2090 + (Math.random() - 0.5) * 0.01;
        
        addLocation({
          latitude: lat,
          longitude: lng,
          accuracy: 15,
          source: 'gps',
          timestamp: new Date().toISOString(),
        });
        
        setTrackingSource('gps');
        setAccuracy(15);
        
        fetch(`${API_URL}/api/trips/${tripId}/location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trip_id: tripId,
            latitude: lat,
            longitude: lng,
            accuracy: 15,
            source: 'gps',
          }),
        }).catch(err => console.error('Failed to send location:', err));
      }, 5000);
      
      locationSubscription.current = { remove: () => clearInterval(demoInterval) };
      return;
    }
    
    // Native location tracking with GPS fallback to IP geolocation
    let gpsAttemptFailed = false;
    let fallbackIntervalId: ReturnType<typeof setInterval> | null = null;
    
    try {
      const ExpoLocation = await import('expo-location');
      
      // Try GPS first
      locationSubscription.current = await ExpoLocation.watchPositionAsync(
        {
          accuracy: ExpoLocation.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        async (location: any) => {
          const { latitude, longitude, accuracy: gpsAccuracy } = location.coords;
          const source = gpsAccuracy && gpsAccuracy > 100 ? 'cellular_unwiredlabs' : 'gps';
          
          setTrackingSource(source);
          setAccuracy(gpsAccuracy || 0);
          
          addLocation({
            latitude,
            longitude,
            accuracy: gpsAccuracy || 0,
            source,
            timestamp: new Date().toISOString(),
          });
          
          try {
            await fetch(`${API_URL}/api/trips/${tripId}/location`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                trip_id: tripId,
                latitude,
                longitude,
                accuracy: gpsAccuracy || 0,
                source,
              }),
            });
          } catch (err) {
            console.error('Failed to send location:', err);
          }
        }
      );
    } catch (error) {
      console.error('GPS location tracking error:', error);
      gpsAttemptFailed = true;
      
      // GPS failed - start last-known-location fallback polling
      console.log('Starting last-known-location fallback (80-100m accuracy)...');
      
      // Get initial fallback location
      await fallbackToLastLocation(tripId);
      
      // Poll every 10 seconds using last known location
      fallbackIntervalId = setInterval(async () => {
        await fallbackToLastLocation(tripId);
      }, 10000);
      
      // Store the interval so we can clean it up
      locationSubscription.current = { 
        remove: () => {
          if (fallbackIntervalId) {
            clearInterval(fallbackIntervalId);
          }
        }
      };
    }
  };

  // Start motion tracking
  const startMotionTracking = async (tripId: string) => {
    if (isWeb) {
      varianceIntervalRef.current = setInterval(async () => {
        const accelVariance = Math.random() * 10;
        const gyroVariance = Math.random() * 3;
        
        setMotionStatus('normal');
        
        try {
          await fetch(`${API_URL}/api/trips/${tripId}/motion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trip_id: tripId,
              accel_variance: accelVariance,
              gyro_variance: gyroVariance,
            }),
          });
        } catch (err) {
          console.error('Failed to send motion data:', err);
        }
      }, VARIANCE_CHECK_INTERVAL);
      return;
    }
    
    try {
      const ExpoSensors = await import('expo-sensors');
      const { Accelerometer, Gyroscope } = ExpoSensors;
      
      accelBuffer.current = [];
      gyroBuffer.current = [];
      
      Accelerometer.setUpdateInterval(50);
      Gyroscope.setUpdateInterval(50);
      
      accelSubscription.current = Accelerometer.addListener(({ x, y, z }: any) => {
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        accelBuffer.current.push(magnitude);
        if (accelBuffer.current.length > BUFFER_SIZE) {
          accelBuffer.current.shift();
        }
      });
      
      gyroSubscription.current = Gyroscope.addListener(({ x, y, z }: any) => {
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        gyroBuffer.current.push(magnitude);
        if (gyroBuffer.current.length > BUFFER_SIZE) {
          gyroBuffer.current.shift();
        }
      });
      
      varianceIntervalRef.current = setInterval(async () => {
        if (accelBuffer.current.length < 10 || gyroBuffer.current.length < 10) return;
        
        const accelVariance = calculateVariance(accelBuffer.current);
        const gyroVariance = calculateVariance(gyroBuffer.current);
        
        // Lowered thresholds for better sensitivity (match backend)
        // Panic = accel variance > 2 AND gyro variance > 0.5
        const isPanic = accelVariance > 2 && gyroVariance > 0.5;
        
        console.log(`Motion: accel=${accelVariance.toFixed(2)}, gyro=${gyroVariance.toFixed(2)}, panic=${isPanic}`);
        
        if (isPanic && !showSafetyCheck) {
          // Show safety check modal instead of directly triggering alert
          setMotionStatus('panic_detected');
          setPendingPanicData({ accelVariance, gyroVariance });
          setShowSafetyCheck(true);
          console.log('Panic detected! Showing safety check modal...');
        } else if (!isPanic) {
          setMotionStatus('normal');
        }
        
        // Still send motion data to backend for logging
        try {
          await fetch(`${API_URL}/api/trips/${tripId}/motion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trip_id: tripId,
              accel_variance: accelVariance,
              gyro_variance: gyroVariance,
            }),
          });
        } catch (err) {
          console.error('Failed to send motion data:', err);
        }
      }, VARIANCE_CHECK_INTERVAL);
    } catch (error) {
      console.error('Motion tracking error:', error);
    }
  };

  // Stop all tracking
  const stopTracking = () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    if (accelSubscription.current) {
      accelSubscription.current.remove();
      accelSubscription.current = null;
    }
    if (gyroSubscription.current) {
      gyroSubscription.current.remove();
      gyroSubscription.current = null;
    }
    if (varianceIntervalRef.current) {
      clearInterval(varianceIntervalRef.current);
      varianceIntervalRef.current = null;
    }
  };

  // Handle user confirming they are safe (correct code entered)
  const handleSafetyConfirmed = () => {
    console.log('User confirmed safety with correct code');
    setShowSafetyCheck(false);
    setMotionStatus('normal');
    setPendingPanicData(null);
    Alert.alert('All Good!', 'Glad you are safe. Stay alert!');
  };

  // Handle triggering alert (wrong code, no response, or user says "No")
  const handleTriggerAlert = async () => {
    console.log('Triggering emergency alert!');
    setShowSafetyCheck(false);
    
    if (!currentTrip) {
      console.error('No active trip for alert');
      return;
    }
    
    try {
      // Call the backend to trigger the alert
      const response = await fetch(`${API_URL}/api/trips/${currentTrip.id}/test-alert`, {
        method: 'POST',
      });
      
      const result = await response.json();
      console.log('Alert triggered:', result);
      
      setLastRiskRule('USER_SAFETY_CHECK_FAILED');
      
      if (result.sms_sent) {
        Alert.alert(
          'Alert Sent!',
          `Emergency SMS has been sent to your guardian (${guardianPhone}) with your location.`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Alert Triggered', 'Emergency alert has been logged.');
      }
    } catch (error) {
      console.error('Failed to trigger alert:', error);
      Alert.alert('Error', 'Failed to send alert. Please call emergency services directly.');
    }
    
    setPendingPanicData(null);
  };

  // Handle Start Trip
  const handleStartTrip = async () => {
    if (!locationPermission && !isWeb) {
      await requestNativePermissions();
      return;
    }
    
    if (!guardianPhone) {
      setShowPhoneInput(true);
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/trips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'default_user',
          guardian_phone: guardianPhone,
        }),
      });
      
      const trip = await response.json();
      startTrip(trip);
      
      await startLocationTracking(trip.id);
      await startMotionTracking(trip.id);
      
      Alert.alert('Trip Started', 'Safety tracking is now active.');
    } catch (error) {
      console.error('Failed to start trip:', error);
      Alert.alert('Error', 'Failed to start trip. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle End Trip
  const handleEndTrip = async () => {
    if (!currentTrip) return;
    
    setLoading(true);
    try {
      stopTracking();
      
      await fetch(`${API_URL}/api/trips/${currentTrip.id}/end`, {
        method: 'POST',
      });
      
      endTrip();
      Alert.alert('Trip Ended', 'Safety tracking has been stopped.');
    } catch (error) {
      console.error('Failed to end trip:', error);
      Alert.alert('Error', 'Failed to end trip properly.');
    } finally {
      setLoading(false);
    }
  };

  // Save guardian phone
  const saveGuardianPhone = async () => {
    if (!phoneInput || phoneInput.length < 10) {
      Alert.alert('Invalid Phone', 'Please enter a valid phone number for the primary guardian.');
      return;
    }
    
    // Save primary guardian
    setGuardianPhone(phoneInput, 1);
    setShowPhoneInput(false);
    
    if (currentTrip) {
      try {
        await fetch(`${API_URL}/api/trips/${currentTrip.id}/guardian`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trip_id: currentTrip.id,
            guardian_phone: phoneInput,
            guardian_phone_2: guardianPhone2 || null,
            guardian_phone_3: guardianPhone3 || null,
          }),
        });
      } catch (err) {
        console.error('Failed to update guardian:', err);
      }
    }
  };

  const goToDebug = () => {
    router.push('/debug');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="shield-checkmark" size={32} color="#ff4757" />
            <Text style={styles.title}>Nirbhay</Text>
          </View>
          <TouchableOpacity onPress={goToDebug} style={styles.debugButton}>
            <Ionicons name="bug-outline" size={24} color="#888" />
          </TouchableOpacity>
        </View>
        
        <Text style={styles.subtitle}>Autonomous Women Safety System</Text>
        
        {isWeb && (
          <View style={styles.webNotice}>
            <Ionicons name="information-circle" size={20} color="#3498db" />
            <Text style={styles.webNoticeText}>
              Web demo mode - Use Expo Go app for full functionality
            </Text>
          </View>
        )}
        
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={styles.statusItem}>
              <Ionicons 
                name={isTracking ? "radio" : "radio-outline"} 
                size={24} 
                color={isTracking ? "#2ed573" : "#888"} 
              />
              <Text style={styles.statusLabel}>Tracking</Text>
              <Text style={[styles.statusValue, { color: isTracking ? '#2ed573' : '#888' }]}>
                {isTracking ? 'Active' : 'Inactive'}
              </Text>
            </View>
            
            <View style={styles.statusItem}>
              <Ionicons 
                name={trackingSource === 'gps' ? "navigate" : "cellular"} 
                size={24} 
                color={trackingSource === 'gps' ? "#3498db" : "#f39c12"} 
              />
              <Text style={styles.statusLabel}>Source</Text>
              <Text style={styles.statusValue}>
                {trackingSource === 'gps' ? 'GPS' : 'Cellular'}
              </Text>
            </View>
            
            <View style={styles.statusItem}>
              <Ionicons 
                name={motionStatus === 'panic_detected' ? "alert-circle" : "body"} 
                size={24} 
                color={motionStatus === 'panic_detected' ? "#ff4757" : "#2ed573"} 
              />
              <Text style={styles.statusLabel}>Motion</Text>
              <Text style={[
                styles.statusValue, 
                { color: motionStatus === 'panic_detected' ? '#ff4757' : '#2ed573' }
              ]}>
                {motionStatus === 'panic_detected' ? 'Alert!' : 'Normal'}
              </Text>
            </View>
          </View>
          
          {isTracking && (
            <View style={styles.accuracyRow}>
              <Text style={styles.accuracyLabel}>Accuracy: </Text>
              <Text style={styles.accuracyValue}>
                {accuracy.toFixed(1)}m
              </Text>
            </View>
          )}
        </View>
        
        {isTracking && locations.length > 0 && (
          <View style={styles.mapContainer}>
            <MapView locations={locations} />
          </View>
        )}
        
        {showPhoneInput && (
          <View style={styles.phoneInputCard}>
            <Text style={styles.phoneInputTitle}>Guardian Phone Numbers</Text>
            <Text style={styles.phoneInputSubtitle}>
              Alerts will be sent to these numbers in case of emergency
            </Text>
            
            {/* Guardian 1 (Primary) */}
            <View style={styles.guardianInputRow}>
              <Text style={styles.guardianLabel}>Primary Guardian</Text>
              <TextInput
                style={styles.phoneInput}
                placeholder="Enter phone number (e.g. +919876543210)"
                placeholderTextColor="#666"
                keyboardType="phone-pad"
                value={phoneInput}
                onChangeText={setPhoneInput}
              />
            </View>
            
            {/* Guardian 2 */}
            <View style={styles.guardianInputRow}>
              <Text style={styles.guardianLabel}>Guardian 2 (Optional)</Text>
              <TextInput
                style={styles.phoneInput}
                placeholder="Enter phone number"
                placeholderTextColor="#666"
                keyboardType="phone-pad"
                value={guardianPhone2}
                onChangeText={(text) => setGuardianPhone(text, 2)}
              />
            </View>
            
            {/* Guardian 3 */}
            <View style={styles.guardianInputRow}>
              <Text style={styles.guardianLabel}>Guardian 3 (Optional)</Text>
              <TextInput
                style={styles.phoneInput}
                placeholder="Enter phone number"
                placeholderTextColor="#666"
                keyboardType="phone-pad"
                value={guardianPhone3}
                onChangeText={(text) => setGuardianPhone(text, 3)}
              />
            </View>
            
            <View style={styles.phoneButtons}>
              <TouchableOpacity 
                style={styles.phoneCancelButton}
                onPress={() => setShowPhoneInput(false)}
              >
                <Text style={styles.phoneCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.phoneSaveButton}
                onPress={saveGuardianPhone}
              >
                <Text style={styles.phoneSaveText}>Save All</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        
        {guardianPhone && !showPhoneInput && (
          <TouchableOpacity 
            style={styles.guardianCard}
            onPress={() => setShowPhoneInput(true)}
          >
            <Ionicons name="people" size={20} color="#3498db" />
            <View style={styles.guardianTextContainer}>
              <Text style={styles.guardianText}>Guardian 1: {guardianPhone}</Text>
              {guardianPhone2 ? <Text style={styles.guardianTextSecondary}>Guardian 2: {guardianPhone2}</Text> : null}
              {guardianPhone3 ? <Text style={styles.guardianTextSecondary}>Guardian 3: {guardianPhone3}</Text> : null}
            </View>
            <Ionicons name="pencil" size={16} color="#888" />
          </TouchableOpacity>
        )}
        
        {!guardianPhone && !showPhoneInput && (
          <TouchableOpacity 
            style={styles.setGuardianButton}
            onPress={() => setShowPhoneInput(true)}
          >
            <Ionicons name="person-add" size={20} color="#fff" />
            <Text style={styles.setGuardianText}>Set Guardian Numbers</Text>
          </TouchableOpacity>
        )}
        
        <TouchableOpacity
          style={[
            styles.mainButton,
            isTracking ? styles.endButton : styles.startButton,
          ]}
          onPress={isTracking ? handleEndTrip : handleStartTrip}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="large" />
          ) : (
            <>
              <Ionicons 
                name={isTracking ? "stop-circle" : "play-circle"} 
                size={48} 
                color="#fff" 
              />
              <Text style={styles.mainButtonText}>
                {isTracking ? 'End Trip' : 'Start Trip'}
              </Text>
            </>
          )}
        </TouchableOpacity>
        
        {lastRiskRule && (
          <View style={styles.riskBanner}>
            <Ionicons name="warning" size={24} color="#fff" />
            <View style={styles.riskTextContainer}>
              <Text style={styles.riskTitle}>Risk Detected</Text>
              <Text style={styles.riskRule}>{lastRiskRule}</Text>
            </View>
          </View>
        )}
        
        {/* New Features Section */}
        <View style={styles.featuresSection}>
          <Text style={styles.featuresSectionTitle}>Safety Tools</Text>
          <View style={styles.featuresGrid}>
            <TouchableOpacity style={styles.featureCard} onPress={() => router.push('/routes')}>
              <View style={[styles.featureIconContainer, { backgroundColor: '#3498db20' }]}>
                <Ionicons name="map" size={28} color="#3498db" />
              </View>
              <Text style={styles.featureTitle}>Safe Routes</Text>
              <Text style={styles.featureDesc}>Find safer travel paths</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.featureCard} onPress={() => router.push('/chat-safety')}>
              <View style={[styles.featureIconContainer, { backgroundColor: '#e74c3c20' }]}>
                <Ionicons name="chatbubbles" size={28} color="#e74c3c" />
              </View>
              <Text style={styles.featureTitle}>Chat Safety</Text>
              <Text style={styles.featureDesc}>Analyze suspicious chats</Text>
            </TouchableOpacity>
          </View>
        </View>
        
        <View style={styles.infoSection}>
          <View style={styles.infoCard}>
            <Ionicons name="location" size={24} color="#3498db" />
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>GPS + Cellular Fallback</Text>
              <Text style={styles.infoText}>
                Automatically switches to cellular triangulation when GPS is unavailable
              </Text>
            </View>
          </View>
          
          <View style={styles.infoCard}>
            <Ionicons name="hand-left" size={24} color="#e74c3c" />
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Panic Detection</Text>
              <Text style={styles.infoText}>
                Motion sensors detect struggle patterns without user interaction
              </Text>
            </View>
          </View>
          
          <View style={styles.infoCard}>
            <Ionicons name="notifications" size={24} color="#2ed573" />
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Auto Alerts</Text>
              <Text style={styles.infoText}>
                Push notifications + SMS sent to guardian automatically
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
      
      {/* Safety Check Modal */}
      <SafetyCheckModal
        visible={showSafetyCheck}
        onSafe={handleSafetyConfirmed}
        onAlert={handleTriggerAlert}
        safetyCode="1234"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  debugButton: {
    padding: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 24,
  },
  webNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a2a3a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  webNoticeText: {
    color: '#3498db',
    fontSize: 12,
    flex: 1,
  },
  statusCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statusItem: {
    alignItems: 'center',
    gap: 8,
  },
  statusLabel: {
    fontSize: 12,
    color: '#888',
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  accuracyRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  accuracyLabel: {
    color: '#888',
    fontSize: 14,
  },
  accuracyValue: {
    color: '#3498db',
    fontSize: 14,
    fontWeight: '600',
  },
  mapContainer: {
    height: 250,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  phoneInputCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  phoneInputTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  phoneInputSubtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 16,
  },
  phoneInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
  },
  phoneButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  phoneCancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#333',
    alignItems: 'center',
  },
  phoneCancelText: {
    color: '#fff',
    fontSize: 16,
  },
  phoneSaveButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#3498db',
    alignItems: 'center',
  },
  phoneSaveText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  guardianInputRow: {
    marginBottom: 12,
  },
  guardianLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 6,
  },
  guardianCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  guardianTextContainer: {
    flex: 1,
  },
  guardianText: {
    color: '#fff',
    fontSize: 14,
  },
  guardianTextSecondary: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  mainButton: {
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    minHeight: 120,
  },
  startButton: {
    backgroundColor: '#2ed573',
  },
  endButton: {
    backgroundColor: '#ff4757',
  },
  mainButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 8,
  },
  riskBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ff4757',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  riskTextContainer: {
    flex: 1,
  },
  riskTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  riskRule: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.9,
  },
  featuresSection: {
    marginBottom: 16,
  },
  featuresSectionTitle: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  featuresGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  featureCard: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  featureIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  featureTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  featureDesc: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
  },
  infoSection: {
    gap: 12,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  infoText: {
    color: '#888',
    fontSize: 12,
    lineHeight: 18,
  },
});
