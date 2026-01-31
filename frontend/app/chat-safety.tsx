import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface RedFlag {
  type: string;
  severity: string;
  evidence: string;
  explanation: string;
}

interface Resource {
  name: string;
  contact?: string;
  url?: string;
  type: string;
}

interface ChatAnalysis {
  risk_level: string;
  risk_score: number;
  red_flags: RedFlag[];
  advisory: string;
  action_items: string[];
  resources: Resource[];
}

export default function ChatSafetyScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<ChatAnalysis | null>(null);

  const pickImage = async () => {
    // Request permissions
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photo library to upload chat screenshots.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setImageBase64(result.assets[0].base64 || null);
      setAnalysis(null);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow camera access to take a screenshot.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setImageBase64(result.assets[0].base64 || null);
      setAnalysis(null);
    }
  };

  const analyzeChat = async () => {
    if (!imageBase64) {
      Alert.alert('No Image', 'Please select or capture a chat screenshot first.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/chat/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: imageBase64,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to analyze chat');
      }

      const data = await response.json();
      setAnalysis(data);
    } catch (error: any) {
      console.error('Chat analysis error:', error);
      Alert.alert('Analysis Failed', error.message || 'Failed to analyze the chat. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'safe': return '#2ed573';
      case 'low_risk': return '#7bed9f';
      case 'moderate_risk': return '#f39c12';
      case 'high_risk': return '#e74c3c';
      case 'dangerous': return '#ff4757';
      default: return '#888';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'low': return '#7bed9f';
      case 'medium': return '#f39c12';
      case 'high': return '#e74c3c';
      case 'critical': return '#ff4757';
      default: return '#888';
    }
  };

  const getRedFlagIcon = (type: string): any => {
    switch (type.toLowerCase()) {
      case 'love_bombing': return 'heart-dislike';
      case 'personal_info_request': return 'document-lock';
      case 'pressure_tactics': return 'warning';
      case 'isolation_attempts': return 'people';
      case 'inappropriate_content': return 'alert-circle';
      default: return 'flag';
    }
  };

  const getRedFlagLabel = (type: string) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View>
            <Text style={styles.title}>Chat Safety</Text>
            <Text style={styles.subtitle}>Detect manipulation & grooming patterns</Text>
          </View>
        </View>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={24} color="#3498db" />
          <Text style={styles.infoText}>
            Upload a screenshot of any suspicious chat conversation. Our AI will analyze it for potential red flags like manipulation, grooming, or social engineering tactics.
          </Text>
        </View>

        {/* Image Selection */}
        <View style={styles.imageSection}>
          {imageUri ? (
            <View style={styles.previewContainer}>
              <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="contain" />
              <TouchableOpacity style={styles.removeImage} onPress={() => {
                setImageUri(null);
                setImageBase64(null);
                setAnalysis(null);
              }}>
                <Ionicons name="close-circle" size={28} color="#ff4757" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.uploadOptions}>
              <TouchableOpacity style={styles.uploadButton} onPress={pickImage}>
                <Ionicons name="images" size={32} color="#3498db" />
                <Text style={styles.uploadText}>Select from Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.uploadButton} onPress={takePhoto}>
                <Ionicons name="camera" size={32} color="#3498db" />
                <Text style={styles.uploadText}>Take Photo</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Analyze Button */}
        {imageUri && (
          <TouchableOpacity
            style={styles.analyzeButton}
            onPress={analyzeChat}
            disabled={loading}
          >
            {loading ? (
              <>
                <ActivityIndicator color="#fff" />
                <Text style={styles.analyzeButtonText}>Analyzing...</Text>
              </>
            ) : (
              <>
                <Ionicons name="shield-checkmark" size={24} color="#fff" />
                <Text style={styles.analyzeButtonText}>Analyze Chat</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Analysis Results */}
        {analysis && (
          <>
            {/* Risk Score Card */}
            <View style={[styles.riskCard, { borderColor: getRiskColor(analysis.risk_level) }]}>
              <View style={styles.riskHeader}>
                <Text style={styles.riskTitle}>Risk Assessment</Text>
                <View style={[styles.riskBadge, { backgroundColor: getRiskColor(analysis.risk_level) }]}>
                  <Text style={styles.riskBadgeText}>
                    {analysis.risk_level.replace(/_/g, ' ').toUpperCase()}
                  </Text>
                </View>
              </View>
              
              <View style={styles.scoreCircle}>
                <Text style={[styles.scoreValue, { color: getRiskColor(analysis.risk_level) }]}>
                  {analysis.risk_score}
                </Text>
                <Text style={styles.scoreLabel}>Risk Score</Text>
              </View>

              <Text style={styles.advisory}>{analysis.advisory}</Text>
            </View>

            {/* Red Flags */}
            {analysis.red_flags.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  <Ionicons name="warning" size={16} color="#ff4757" /> Red Flags Detected ({analysis.red_flags.length})
                </Text>
                {analysis.red_flags.map((flag, idx) => (
                  <View key={idx} style={styles.flagCard}>
                    <View style={styles.flagHeader}>
                      <View style={[styles.flagIconContainer, { backgroundColor: getSeverityColor(flag.severity) + '20' }]}>
                        <Ionicons 
                          name={getRedFlagIcon(flag.type)} 
                          size={20} 
                          color={getSeverityColor(flag.severity)} 
                        />
                      </View>
                      <View style={styles.flagInfo}>
                        <Text style={styles.flagType}>{getRedFlagLabel(flag.type)}</Text>
                        <View style={[styles.severityBadge, { backgroundColor: getSeverityColor(flag.severity) }]}>
                          <Text style={styles.severityText}>{flag.severity.toUpperCase()}</Text>
                        </View>
                      </View>
                    </View>
                    {flag.evidence && (
                      <View style={styles.evidenceBox}>
                        <Text style={styles.evidenceLabel}>Evidence:</Text>
                        <Text style={styles.evidenceText}>"{flag.evidence}"</Text>
                      </View>
                    )}
                    <Text style={styles.flagExplanation}>{flag.explanation}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* No Red Flags - Safe */}
            {analysis.red_flags.length === 0 && (
              <View style={styles.safeCard}>
                <Ionicons name="checkmark-circle" size={48} color="#2ed573" />
                <Text style={styles.safeTitle}>No Red Flags Detected</Text>
                <Text style={styles.safeText}>
                  This conversation appears to be normal. However, always trust your instincts if something feels wrong.
                </Text>
              </View>
            )}

            {/* Action Items */}
            {analysis.action_items.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>What You Should Do</Text>
                <View style={styles.actionsCard}>
                  {analysis.action_items.map((item, idx) => (
                    <View key={idx} style={styles.actionItem}>
                      <View style={styles.actionNumber}>
                        <Text style={styles.actionNumberText}>{idx + 1}</Text>
                      </View>
                      <Text style={styles.actionText}>{item}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Resources */}
            {analysis.resources.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Helpful Resources</Text>
                <View style={styles.resourcesGrid}>
                  {analysis.resources.map((resource, idx) => (
                    <View key={idx} style={styles.resourceCard}>
                      <Ionicons 
                        name={resource.type === 'helpline' ? 'call' : 'globe'} 
                        size={24} 
                        color="#3498db" 
                      />
                      <Text style={styles.resourceName}>{resource.name}</Text>
                      {resource.contact && (
                        <Text style={styles.resourceContact}>{resource.contact}</Text>
                      )}
                      {resource.url && (
                        <Text style={styles.resourceUrl} numberOfLines={1}>{resource.url}</Text>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}

        {/* Tips Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Safety Tips</Text>
          <View style={styles.tipsCard}>
            <View style={styles.tipItem}>
              <Ionicons name="shield" size={20} color="#3498db" />
              <Text style={styles.tipText}>Never share personal info with strangers online</Text>
            </View>
            <View style={styles.tipItem}>
              <Ionicons name="eye-off" size={20} color="#3498db" />
              <Text style={styles.tipText}>Be cautious of people who ask for photos or videos</Text>
            </View>
            <View style={styles.tipItem}>
              <Ionicons name="people" size={20} color="#3498db" />
              <Text style={styles.tipText}>Talk to a trusted adult if something feels wrong</Text>
            </View>
            <View style={styles.tipItem}>
              <Ionicons name="document-text" size={20} color="#3498db" />
              <Text style={styles.tipText}>Save evidence of suspicious conversations</Text>
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
    marginBottom: 20,
  },
  backButton: {
    padding: 8,
    marginRight: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#1a2a3a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    gap: 12,
  },
  infoText: {
    flex: 1,
    color: '#3498db',
    fontSize: 14,
    lineHeight: 20,
  },
  imageSection: {
    marginBottom: 20,
  },
  uploadOptions: {
    flexDirection: 'row',
    gap: 12,
  },
  uploadButton: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#333',
    borderStyle: 'dashed',
  },
  uploadText: {
    color: '#888',
    fontSize: 14,
    marginTop: 8,
  },
  previewContainer: {
    position: 'relative',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    overflow: 'hidden',
  },
  preview: {
    width: '100%',
    height: 300,
  },
  removeImage: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
  },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e74c3c',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    marginBottom: 20,
  },
  analyzeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  riskCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 2,
    alignItems: 'center',
  },
  riskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  riskTitle: {
    color: '#888',
    fontSize: 14,
  },
  riskBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  riskBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  scoreCircle: {
    alignItems: 'center',
    marginBottom: 16,
  },
  scoreValue: {
    fontSize: 56,
    fontWeight: 'bold',
  },
  scoreLabel: {
    color: '#888',
    fontSize: 14,
  },
  advisory: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  flagCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  flagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  flagIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  flagInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  flagType: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  severityText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  evidenceBox: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  evidenceLabel: {
    color: '#888',
    fontSize: 11,
    marginBottom: 4,
  },
  evidenceText: {
    color: '#f39c12',
    fontSize: 13,
    fontStyle: 'italic',
  },
  flagExplanation: {
    color: '#888',
    fontSize: 13,
    lineHeight: 20,
  },
  safeCard: {
    backgroundColor: '#1a3a1a',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  safeTitle: {
    color: '#2ed573',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 8,
  },
  safeText: {
    color: '#7bed9f',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  actionsCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 12,
  },
  actionNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3498db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionNumberText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  actionText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  resourcesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  resourceCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    width: '47%',
    alignItems: 'center',
  },
  resourceName: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  resourceContact: {
    color: '#3498db',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 4,
  },
  resourceUrl: {
    color: '#888',
    fontSize: 10,
    marginTop: 4,
  },
  tipsCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  tipText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
});
