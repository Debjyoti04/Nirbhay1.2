import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface LocationPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  source: 'gps' | 'cellular_unwiredlabs';
  timestamp: string;
  accuracy_radius?: number;
}

export interface Trip {
  id: string;
  user_id: string;
  status: 'active' | 'ended' | 'alert';
  start_time: string;
  end_time?: string;
  guardian_phone?: string;
  guardian_fcm_token?: string;
}

interface TripState {
  currentTrip: Trip | null;
  isTracking: boolean;
  locations: LocationPoint[];
  motionStatus: 'normal' | 'panic_detected';
  lastRiskRule: string | null;
  guardianPhone: string;
  trackingSource: 'gps' | 'cellular_unwiredlabs';
  accuracy: number;
  
  // Actions
  setGuardianPhone: (phone: string) => void;
  startTrip: (trip: Trip) => void;
  endTrip: () => void;
  addLocation: (location: LocationPoint) => void;
  setMotionStatus: (status: 'normal' | 'panic_detected') => void;
  setLastRiskRule: (rule: string | null) => void;
  setTrackingSource: (source: 'gps' | 'cellular_unwiredlabs') => void;
  setAccuracy: (accuracy: number) => void;
  clearLocations: () => void;
  loadSavedGuardian: () => Promise<void>;
}

export const useTripStore = create<TripState>((set, get) => ({
  currentTrip: null,
  isTracking: false,
  locations: [],
  motionStatus: 'normal',
  lastRiskRule: null,
  guardianPhone: '',
  trackingSource: 'gps',
  accuracy: 0,
  
  setGuardianPhone: async (phone: string) => {
    set({ guardianPhone: phone });
    // Persist to storage
    try {
      await AsyncStorage.setItem('guardian_phone', phone);
    } catch (e) {
      console.error('Failed to save guardian phone:', e);
    }
  },
  
  startTrip: (trip: Trip) => {
    set({
      currentTrip: trip,
      isTracking: true,
      locations: [],
      motionStatus: 'normal',
      lastRiskRule: null,
    });
  },
  
  endTrip: () => {
    set({
      currentTrip: null,
      isTracking: false,
      motionStatus: 'normal',
      lastRiskRule: null,
    });
  },
  
  addLocation: (location: LocationPoint) => {
    set((state) => ({
      locations: [...state.locations, location].slice(-100), // Keep last 100 points
    }));
  },
  
  setMotionStatus: (status: 'normal' | 'panic_detected') => {
    set({ motionStatus: status });
  },
  
  setLastRiskRule: (rule: string | null) => {
    set({ lastRiskRule: rule });
  },
  
  setTrackingSource: (source: 'gps' | 'cellular_unwiredlabs') => {
    set({ trackingSource: source });
  },
  
  setAccuracy: (accuracy: number) => {
    set({ accuracy });
  },
  
  clearLocations: () => {
    set({ locations: [] });
  },
  
  loadSavedGuardian: async () => {
    try {
      const saved = await AsyncStorage.getItem('guardian_phone');
      if (saved) {
        set({ guardianPhone: saved });
      }
    } catch (e) {
      console.error('Failed to load guardian phone:', e);
    }
  },
}));
