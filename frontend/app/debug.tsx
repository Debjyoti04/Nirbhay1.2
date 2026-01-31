import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTripStore } from '../store/tripStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface DebugInfo {
  trip_id: string;
  status: string;
  tracking_source: string;
  accuracy: number;
  accuracy_radius: number | null;
  total_locations: number;
  total_motion_events: number;
  motion_status: string;
  last_risk_rule: string | null;
  last_risk_confidence: number | null;
  guardian_phone: string;
  last_location: any;
}

export default function DebugScreen() {
  const { currentTrip, isTracking, locations, motionStatus } = useTripStore();
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [healthStatus, setHealthStatus] = useState<any>(null);

  useEffect(() => {
    fetchHealthStatus();
    if (currentTrip) {
      fetchDebugInfo();
    }
  }, [currentTrip]);

  const fetchHealthStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/api/health`);
      const data = await response.json();
      setHealthStatus(data);
    } catch (error) {
      console.error('Health check failed:', error);
    }
  };

  const fetchDebugInfo = async () => {
    if (!currentTrip) return;
    
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/trips/${currentTrip.id}/debug`);
      const data = await response.json();
      setDebugInfo(data);
    } catch (error) {
      console.error('Debug info fetch failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchHealthStatus();
    if (currentTrip) {
      await fetchDebugInfo();
    }
    setRefreshing(false);
  };

  const testAlert = async () => {
    if (!currentTrip) return;
    
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/trips/${currentTrip.id}/test-alert`, {
        method: 'POST',
      });
      const data = await response.json();
      alert(`Test Alert Result:\nPush: ${data.push_sent}\nSMS: ${data.sms_sent}`);
    } catch (error) {
      console.error('Test alert failed:', error);
      alert('Test alert failed');
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    router.back();
  };

  const StatusBadge = ({ value, goodValue, label }: { value: string; goodValue: string; label: string }) => (
    <View style={styles.badgeContainer}>
      <View style={[
        styles.badge,
        { backgroundColor: value === goodValue ? '#2ed573' : '#f39c12' }
      ]}>
        <Text style={styles.badgeText}>{value}</Text>
      </View>
      <Text style={styles.badgeLabel}>{label}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Debug & Transparency</Text>
        </View>
        
        <Text style={styles.subtitle}>For judges and demo verification</Text>
        
        {/* Health Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>System Health</Text>
          <View style={styles.card}>
            {healthStatus ? (
              <>
                <View style={styles.row}>
                  <Text style={styles.label}>Status:</Text>
                  <Text style={[
                    styles.value,
                    { color: healthStatus.status === 'healthy' ? '#2ed573' : '#ff4757' }
                  ]}>
                    {healthStatus.status}
                  </Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Database:</Text>
                  <Text style={styles.value}>{healthStatus.services?.database || 'N/A'}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Unwired Labs:</Text>
                  <Text style={[
                    styles.value,
                    { color: healthStatus.services?.unwired_labs === 'configured' ? '#2ed573' : '#f39c12' }
                  ]}>
                    {healthStatus.services?.unwired_labs || 'N/A'}
                  </Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>MSG91 SMS:</Text>
                  <Text style={[
                    styles.value,
                    { color: healthStatus.services?.msg91 === 'configured' ? '#2ed573' : '#f39c12' }
                  ]}>
                    {healthStatus.services?.msg91 || 'N/A'}
                  </Text>
                </View>
              </>
            ) : (
              <ActivityIndicator color="#fff" />
            )}
          </View>
        </View>
        
        {/* Trip Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Current Trip Status</Text>
          <View style={styles.card}>
            {isTracking ? (
              loading && !debugInfo ? (
                <ActivityIndicator color="#fff" />
              ) : debugInfo ? (
                <>
                  <View style={styles.badgeRow}>
                    <StatusBadge 
                      value={debugInfo.status} 
                      goodValue="active" 
                      label="Status" 
                    />
                    <StatusBadge 
                      value={debugInfo.tracking_source} 
                      goodValue="gps" 
                      label="Source" 
                    />
                    <StatusBadge 
                      value={debugInfo.motion_status} 
                      goodValue="normal" 
                      label="Motion" 
                    />
                  </View>
                  
                  <View style={styles.divider} />
                  
                  <View style={styles.row}>
                    <Text style={styles.label}>Trip ID:</Text>
                    <Text style={styles.valueSmall}>{debugInfo.trip_id.slice(0, 8)}...</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>Accuracy:</Text>
                    <Text style={styles.value}>{debugInfo.accuracy.toFixed(1)}m</Text>
                  </View>
                  {debugInfo.accuracy_radius && (
                    <View style={styles.row}>
                      <Text style={styles.label}>Accuracy Radius:</Text>
                      <Text style={styles.value}>{debugInfo.accuracy_radius}m</Text>
                    </View>
                  )}
                  <View style={styles.row}>
                    <Text style={styles.label}>Total Locations:</Text>
                    <Text style={styles.value}>{debugInfo.total_locations}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>Motion Events:</Text>
                    <Text style={styles.value}>{debugInfo.total_motion_events}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>Guardian:</Text>
                    <Text style={styles.value}>{debugInfo.guardian_phone}</Text>
                  </View>
                  
                  {debugInfo.last_risk_rule && (
                    <>
                      <View style={styles.divider} />
                      <View style={styles.riskInfo}>
                        <Ionicons name="warning" size={20} color="#ff4757" />
                        <View style={styles.riskTextContainer}>
                          <Text style={styles.riskLabel}>Last Risk Rule:</Text>
                          <Text style={styles.riskValue}>{debugInfo.last_risk_rule}</Text>
                          <Text style={styles.riskConfidence}>
                            Confidence: {((debugInfo.last_risk_confidence || 0) * 100).toFixed(0)}%
                          </Text>
                        </View>
                      </View>
                    </>
                  )}
                  
                  {debugInfo.last_location && (
                    <>
                      <View style={styles.divider} />
                      <Text style={styles.subTitle}>Last Known Location</Text>
                      <View style={styles.row}>
                        <Text style={styles.label}>Lat:</Text>
                        <Text style={styles.valueSmall}>
                          {debugInfo.last_location.latitude.toFixed(6)}
                        </Text>
                      </View>
                      <View style={styles.row}>
                        <Text style={styles.label}>Lng:</Text>
                        <Text style={styles.valueSmall}>
                          {debugInfo.last_location.longitude.toFixed(6)}
                        </Text>
                      </View>
                    </>
                  )}
                </>
              ) : (
                <Text style={styles.noData}>Fetching debug info...</Text>
              )
            ) : (
              <Text style={styles.noData}>No active trip. Start a trip to see debug info.</Text>
            )}
          </View>
        </View>
        
        {/* Local State */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Local App State</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Is Tracking:</Text>
              <Text style={[
                styles.value,
                { color: isTracking ? '#2ed573' : '#888' }
              ]}>
                {isTracking ? 'Yes' : 'No'}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Local Locations:</Text>
              <Text style={styles.value}>{locations.length}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Motion Status:</Text>
              <Text style={[
                styles.value,
                { color: motionStatus === 'panic_detected' ? '#ff4757' : '#2ed573' }
              ]}>
                {motionStatus}
              </Text>
            </View>
          </View>
        </View>
        
        {/* Test Alert Button */}
        {isTracking && (
          <TouchableOpacity 
            style={styles.testButton}
            onPress={testAlert}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="notifications" size={20} color="#fff" />
                <Text style={styles.testButtonText}>Test Alert System</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        
        {/* Risk Rules Explanation */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Risk Detection Rules</Text>
          <View style={styles.card}>
            <View style={styles.ruleItem}>
              <Text style={styles.ruleName}>PANIC_MOVEMENT_ABNORMAL_STOP</Text>
              <Text style={styles.ruleDesc}>
                Panic movement detected followed by sudden stop (confidence: 70%)
              </Text>
            </View>
            <View style={styles.ruleItem}>
              <Text style={styles.ruleName}>PANIC_MOVEMENT_NIGHT</Text>
              <Text style={styles.ruleDesc}>
                Panic movement during night hours 10PM-5AM (confidence: 65%)
              </Text>
            </View>
            <View style={styles.ruleItem}>
              <Text style={styles.ruleName}>GPS_LOSS_CELLULAR_MOVEMENT</Text>
              <Text style={styles.ruleDesc}>
                GPS lost, tracking via cellular with continued movement (confidence: 50%)
              </Text>
            </View>
            <View style={styles.ruleItem}>
              <Text style={styles.ruleName}>PROLONGED_STOP_UNUSUAL_LOCATION</Text>
              <Text style={styles.ruleDesc}>
                Extended stop after significant movement (confidence: 55%)
              </Text>
            </View>
          </View>
        </View>
        
        {/* Thresholds */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Detection Thresholds</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Panic Accel Variance:</Text>
              <Text style={styles.value}>{"> 15 m/s²"}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Panic Gyro Variance:</Text>
              <Text style={styles.value}>{"> 5 rad/s"}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>GPS Fallback:</Text>
              <Text style={styles.value}>{"accuracy > 100m"}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Night Hours:</Text>
              <Text style={styles.value}>10PM - 5AM</Text>
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
    alignItems: 'center',
    marginBottom: 8,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 24,
    marginLeft: 40,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#888',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  label: {
    color: '#888',
    fontSize: 14,
  },
  value: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  valueSmall: {
    color: '#fff',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  badgeContainer: {
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  badgeLabel: {
    color: '#888',
    fontSize: 11,
  },
  divider: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 12,
  },
  subTitle: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
  },
  noData: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    padding: 20,
  },
  riskInfo: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  riskTextContainer: {
    flex: 1,
  },
  riskLabel: {
    color: '#ff4757',
    fontSize: 12,
  },
  riskValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  riskConfidence: {
    color: '#888',
    fontSize: 12,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ff4757',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  testButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  ruleItem: {
    marginBottom: 16,
  },
  ruleName: {
    color: '#3498db',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 4,
  },
  ruleDesc: {
    color: '#888',
    fontSize: 12,
    lineHeight: 18,
  },
});
