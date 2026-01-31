import React, { useEffect, useState, useRef, useCallback } from 'react';
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

// Conditional imports for native-only modules
let Location: typeof import('expo-location') | null = null;
let Accelerometer: typeof import('expo-sensors').Accelerometer | null = null;
let Gyroscope: typeof import('expo-sensors').Gyroscope | null = null;

// Only import native modules on native platforms
if (Platform.OS !== 'web') {
  Location = require('expo-location');
  const sensors = require('expo-sensors');
  Accelerometer = sensors.Accelerometer;
  Gyroscope = sensors.Gyroscope;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function HomeScreen() {
  const {
    currentTrip,
    isTracking,
    locations,
    motionStatus,
    lastRiskRule,
    guardianPhone,
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
  const [locationPermission, setLocationPermission] = useState(false);
  
  // Sensor subscriptions
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const accelSubscription = useRef<any>(null);
  const gyroSubscription = useRef<any>(null);
  
  // Motion data buffers for variance calculation
  const accelBuffer = useRef<number[]>([]);
  const gyroBuffer = useRef<number[]>([]);
  const BUFFER_SIZE = 50; // ~2.5 seconds at 20Hz
  const VARIANCE_CHECK_INTERVAL = 2000; // Check every 2 seconds

  // Request permissions on mount
  useEffect(() => {
    requestPermissions();
  }, []);

  const requestPermissions = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        setLocationPermission(true);
        // Also request background permission
        await Location.requestBackgroundPermissionsAsync();
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

  // Calculate variance of array
  const calculateVariance = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const squaredDiffs = arr.map(x => Math.pow(x - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / arr.length;
  };

  // Start location tracking
  const startLocationTracking = async (tripId: string) => {
    try {
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000, // Every 5 seconds
          distanceInterval: 10, // Or every 10 meters
        },
        async (location) => {
          const { latitude, longitude, accuracy: gpsAccuracy } = location.coords;
          
          // Determine source based on accuracy
          // GPS accuracy > 100m is considered poor, fallback to cellular
          const source = gpsAccuracy && gpsAccuracy > 100 ? 'cellular_unwiredlabs' : 'gps';
          
          setTrackingSource(source);
          setAccuracy(gpsAccuracy || 0);
          
          // Add to local store
          addLocation({
            latitude,
            longitude,
            accuracy: gpsAccuracy || 0,
            source,
            timestamp: new Date().toISOString(),
          });
          
          // Send to backend
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
      console.error('Location tracking error:', error);
    }
  };

  // Start motion tracking
  const startMotionTracking = (tripId: string) => {
    // Reset buffers
    accelBuffer.current = [];
    gyroBuffer.current = [];
    
    // Set update intervals (50ms = 20Hz)
    Accelerometer.setUpdateInterval(50);
    Gyroscope.setUpdateInterval(50);
    
    // Subscribe to accelerometer
    accelSubscription.current = Accelerometer.addListener(({ x, y, z }) => {
      // Calculate magnitude
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      accelBuffer.current.push(magnitude);
      if (accelBuffer.current.length > BUFFER_SIZE) {
        accelBuffer.current.shift();
      }
    });
    
    // Subscribe to gyroscope
    gyroSubscription.current = Gyroscope.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      gyroBuffer.current.push(magnitude);
      if (gyroBuffer.current.length > BUFFER_SIZE) {
        gyroBuffer.current.shift();
      }
    });
    
    // Periodic variance check
    const varianceInterval = setInterval(async () => {
      if (accelBuffer.current.length < 10 || gyroBuffer.current.length < 10) return;
      
      const accelVariance = calculateVariance(accelBuffer.current);
      const gyroVariance = calculateVariance(gyroBuffer.current);
      
      // Check if this indicates panic (thresholds from backend)
      const isPanic = accelVariance > 15 && gyroVariance > 5;
      
      setMotionStatus(isPanic ? 'panic_detected' : 'normal');
      
      // Send to backend
      try {
        const response = await fetch(`${API_URL}/api/trips/${tripId}/motion`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trip_id: tripId,
            accel_variance: accelVariance,
            gyro_variance: gyroVariance,
          }),
        });
        
        const data = await response.json();
        if (data.is_panic) {
          setMotionStatus('panic_detected');
        }
      } catch (err) {
        console.error('Failed to send motion data:', err);
      }
    }, VARIANCE_CHECK_INTERVAL);
    
    return varianceInterval;
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
  };

  // Handle Start Trip
  const handleStartTrip = async () => {
    if (!locationPermission) {
      await requestPermissions();
      return;
    }
    
    if (!guardianPhone) {
      setShowPhoneInput(true);
      return;
    }
    
    setLoading(true);
    try {
      // Create trip on backend
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
      
      // Start tracking services
      await startLocationTracking(trip.id);
      startMotionTracking(trip.id);
      
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
      // Stop tracking
      stopTracking();
      
      // End trip on backend
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
      Alert.alert('Invalid Phone', 'Please enter a valid phone number.');
      return;
    }
    
    setGuardianPhone(phoneInput);
    setShowPhoneInput(false);
    
    // If trip is active, update guardian on backend
    if (currentTrip) {
      try {
        await fetch(`${API_URL}/api/trips/${currentTrip.id}/guardian`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trip_id: currentTrip.id,
            guardian_phone: phoneInput,
          }),
        });
      } catch (err) {
        console.error('Failed to update guardian:', err);
      }
    }
  };

  // Navigate to debug screen
  const goToDebug = () => {
    router.push('/debug');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
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
        
        {/* Status Card */}
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
        
        {/* Map View */}
        {isTracking && locations.length > 0 && (
          <View style={styles.mapContainer}>
            <MapView locations={locations} />
          </View>
        )}
        
        {/* Guardian Phone Input */}
        {showPhoneInput && (
          <View style={styles.phoneInputCard}>
            <Text style={styles.phoneInputTitle}>Guardian Phone Number</Text>
            <Text style={styles.phoneInputSubtitle}>
              Alerts will be sent to this number in case of emergency
            </Text>
            <TextInput
              style={styles.phoneInput}
              placeholder="Enter phone number"
              placeholderTextColor="#666"
              keyboardType="phone-pad"
              value={phoneInput}
              onChangeText={setPhoneInput}
            />
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
                <Text style={styles.phoneSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        
        {/* Guardian Info */}
        {guardianPhone && !showPhoneInput && (
          <TouchableOpacity 
            style={styles.guardianCard}
            onPress={() => setShowPhoneInput(true)}
          >
            <Ionicons name="people" size={20} color="#3498db" />
            <Text style={styles.guardianText}>Guardian: {guardianPhone}</Text>
            <Ionicons name="pencil" size={16} color="#888" />
          </TouchableOpacity>
        )}
        
        {/* Main Action Button */}
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
        
        {/* Risk Alert Banner */}
        {lastRiskRule && (
          <View style={styles.riskBanner}>
            <Ionicons name="warning" size={24} color="#fff" />
            <View style={styles.riskTextContainer}>
              <Text style={styles.riskTitle}>Risk Detected</Text>
              <Text style={styles.riskRule}>{lastRiskRule}</Text>
            </View>
          </View>
        )}
        
        {/* Info Cards */}
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
  guardianCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  guardianText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
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
