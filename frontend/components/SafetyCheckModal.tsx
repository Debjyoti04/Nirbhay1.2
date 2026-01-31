import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Vibration,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface SafetyCheckModalProps {
  visible: boolean;
  onSafe: () => void;
  onAlert: () => void;
  safetyCode?: string;
}

const SAFETY_CODE = '1234';
const TIMEOUT_SECONDS = 20;

export default function SafetyCheckModal({
  visible,
  onSafe,
  onAlert,
  safetyCode = SAFETY_CODE,
}: SafetyCheckModalProps) {
  const [step, setStep] = useState<'question' | 'code'>('question');
  const [codeInput, setCodeInput] = useState('');
  const [countdown, setCountdown] = useState(TIMEOUT_SECONDS);
  const [codeError, setCodeError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setStep('question');
      setCodeInput('');
      setCountdown(TIMEOUT_SECONDS);
      setCodeError(false);
      
      // Vibrate to alert user
      if (Platform.OS !== 'web') {
        Vibration.vibrate([500, 500, 500, 500, 500]);
      }
      
      // Start countdown timer
      timerRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            // Time's up - trigger alert
            clearInterval(timerRef.current!);
            onAlert();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      // Clear timer when modal closes
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [visible]);

  const handleYes = () => {
    setStep('code');
    // Reset countdown for code entry
    setCountdown(TIMEOUT_SECONDS);
  };

  const handleNo = () => {
    // User says they're not okay - trigger alert
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    onAlert();
  };

  const handleCodeSubmit = () => {
    if (codeInput === safetyCode) {
      // Correct code - user is safe
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      onSafe();
    } else {
      // Wrong code - potential duress, trigger alert
      setCodeError(true);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      // Small delay to show error before triggering
      setTimeout(() => {
        onAlert();
      }, 500);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Countdown Timer */}
          <View style={styles.timerContainer}>
            <View style={[
              styles.timerCircle,
              countdown <= 5 && styles.timerCircleUrgent
            ]}>
              <Text style={[
                styles.timerText,
                countdown <= 5 && styles.timerTextUrgent
              ]}>
                {countdown}
              </Text>
            </View>
            <Text style={styles.timerLabel}>
              {countdown <= 5 ? 'Alert in...' : 'Respond within'}
            </Text>
          </View>

          {step === 'question' ? (
            <>
              {/* Question Step */}
              <View style={styles.iconContainer}>
                <Ionicons name="alert-circle" size={60} color="#ff4757" />
              </View>
              
              <Text style={styles.title}>Safety Check</Text>
              <Text style={styles.subtitle}>
                Unusual movement detected
              </Text>
              <Text style={styles.question}>Are you feeling okay?</Text>
              
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.button, styles.noButton]}
                  onPress={handleNo}
                >
                  <Ionicons name="close" size={24} color="#fff" />
                  <Text style={styles.buttonText}>No</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[styles.button, styles.yesButton]}
                  onPress={handleYes}
                >
                  <Ionicons name="checkmark" size={24} color="#fff" />
                  <Text style={styles.buttonText}>Yes</Text>
                </TouchableOpacity>
              </View>
              
              <Text style={styles.hint}>
                If you don't respond, an alert will be sent automatically
              </Text>
            </>
          ) : (
            <>
              {/* Code Entry Step */}
              <View style={styles.iconContainer}>
                <Ionicons name="lock-closed" size={60} color="#3498db" />
              </View>
              
              <Text style={styles.title}>Enter Safety Code</Text>
              <Text style={styles.subtitle}>
                Please enter your 4-digit safety code
              </Text>
              
              <TextInput
                style={[
                  styles.codeInput,
                  codeError && styles.codeInputError
                ]}
                value={codeInput}
                onChangeText={(text) => {
                  setCodeError(false);
                  setCodeInput(text.replace(/[^0-9]/g, '').slice(0, 4));
                }}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="• • • •"
                placeholderTextColor="#666"
                autoFocus
                secureTextEntry
              />
              
              {codeError && (
                <Text style={styles.errorText}>
                  Wrong code! Sending alert...
                </Text>
              )}
              
              <TouchableOpacity
                style={[
                  styles.submitButton,
                  codeInput.length < 4 && styles.submitButtonDisabled
                ]}
                onPress={handleCodeSubmit}
                disabled={codeInput.length < 4}
              >
                <Text style={styles.submitButtonText}>Verify</Text>
              </TouchableOpacity>
              
              <TouchableOpacity onPress={() => setStep('question')}>
                <Text style={styles.backLink}>Go back</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modal: {
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 350,
    alignItems: 'center',
  },
  timerContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  timerCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#2a2a2a',
    borderWidth: 3,
    borderColor: '#3498db',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerCircleUrgent: {
    borderColor: '#ff4757',
    backgroundColor: '#3a1a1a',
  },
  timerText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#3498db',
  },
  timerTextUrgent: {
    color: '#ff4757',
  },
  timerLabel: {
    color: '#888',
    fontSize: 12,
    marginTop: 8,
  },
  iconContainer: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 16,
    textAlign: 'center',
  },
  question: {
    fontSize: 20,
    color: '#fff',
    marginBottom: 24,
    textAlign: 'center',
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    minWidth: 120,
  },
  yesButton: {
    backgroundColor: '#2ed573',
  },
  noButton: {
    backgroundColor: '#ff4757',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  hint: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  codeInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    fontSize: 32,
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 16,
    width: '80%',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#3a3a3a',
  },
  codeInputError: {
    borderColor: '#ff4757',
    backgroundColor: '#3a1a1a',
  },
  errorText: {
    color: '#ff4757',
    fontSize: 14,
    marginBottom: 16,
  },
  submitButton: {
    backgroundColor: '#3498db',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    marginBottom: 16,
  },
  submitButtonDisabled: {
    backgroundColor: '#2a2a2a',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  backLink: {
    color: '#888',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
