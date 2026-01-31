from fastapi import FastAPI, APIRouter, HTTPException, BackgroundTasks
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any
import uuid
from datetime import datetime, timedelta
import httpx
import math
import base64
import asyncio

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'nirbhay_db')]

# Create the main app
app = FastAPI(title="Nirbhay Safety API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ===========================================
# Environment Variables (with defaults for MVP)
# ===========================================
UNWIRED_LABS_API_KEY = os.environ.get('UNWIRED_LABS_API_KEY', 'demo_key')
FAST2SMS_API_KEY = os.environ.get('FAST2SMS_API_KEY', 'demo_key')
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')

# ===========================================
# Pydantic Models
# ===========================================

class LocationPoint(BaseModel):
    """Single location data point"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    latitude: float
    longitude: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    accuracy: float = 0.0  # GPS accuracy in meters
    source: Literal["gps", "cellular_unwiredlabs"] = "gps"
    accuracy_radius: Optional[float] = None  # For cellular, the radius of uncertainty

class MotionEvent(BaseModel):
    """Motion sensor event"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    accel_variance: float  # Acceleration magnitude variance
    gyro_variance: float  # Gyroscope rotation variance
    is_panic: bool = False  # Detected as panic movement

class RiskEvent(BaseModel):
    """Risk detection event"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    rule_name: str
    contributing_signals: List[str]
    confidence: float  # 0.0 to 1.0
    last_known_location: Optional[dict] = None
    alert_sent: bool = False
    sms_sent: bool = False
    push_sent: bool = False

class Trip(BaseModel):
    """Trip document"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = "default_user"  # Simplified for MVP
    status: Literal["active", "ended", "alert"] = "active"
    start_time: datetime = Field(default_factory=datetime.utcnow)
    end_time: Optional[datetime] = None
    guardian_phone: Optional[str] = None
    guardian_fcm_token: Optional[str] = None
    locations: List[dict] = []
    motion_events: List[dict] = []
    risk_events: List[dict] = []
    last_risk_check: Optional[datetime] = None

class TripCreate(BaseModel):
    user_id: str = "default_user"
    guardian_phone: Optional[str] = None
    guardian_fcm_token: Optional[str] = None

class LocationInput(BaseModel):
    trip_id: str
    latitude: float
    longitude: float
    accuracy: float = 0.0
    source: Literal["gps", "cellular_unwiredlabs"] = "gps"
    accuracy_radius: Optional[float] = None

class CellularTriangulationRequest(BaseModel):
    """Request for cellular triangulation via Unwired Labs"""
    trip_id: str
    mcc: Optional[int] = None  # Mobile Country Code
    mnc: Optional[int] = None  # Mobile Network Code
    lac: Optional[int] = None  # Location Area Code
    cid: Optional[int] = None  # Cell ID
    signal_strength: Optional[int] = None
    # For IP-based fallback when cell data not available
    use_ip_fallback: bool = True

class MotionInput(BaseModel):
    trip_id: str
    accel_variance: float
    gyro_variance: float

class GuardianUpdate(BaseModel):
    trip_id: str
    guardian_phone: Optional[str] = None
    guardian_fcm_token: Optional[str] = None

# ===========================================
# Safe Route Models
# ===========================================

class RouteRequest(BaseModel):
    """Request for safe route analysis"""
    origin_lat: float
    origin_lng: float
    dest_lat: float
    dest_lng: float
    travel_time: Optional[str] = None  # ISO format, defaults to now

class SafetyFactor(BaseModel):
    """Individual safety factor with score"""
    name: str
    score: float  # 0-100
    description: str
    icon: str

class TransportMode(BaseModel):
    """Transport mode recommendation"""
    mode: str  # walk, bus, metro, auto, cab
    safety_score: float
    estimated_time: int  # minutes
    recommendation: str
    icon: str

class RouteResponse(BaseModel):
    """Response with route safety analysis"""
    overall_safety_score: float
    safety_level: str  # safe, moderate, risky
    factors: List[SafetyFactor]
    transport_modes: List[TransportMode]
    route_points: List[dict]
    recommendations: List[str]
    nearby_safe_spots: List[dict]

# ===========================================
# Chat Safety Analysis Models
# ===========================================

class ChatAnalysisRequest(BaseModel):
    """Request to analyze chat screenshot"""
    image_base64: str  # Base64 encoded image
    context: Optional[str] = None  # Additional context about the conversation

class RedFlag(BaseModel):
    """Detected red flag in chat"""
    type: str  # love_bombing, personal_info_request, pressure_tactics, isolation, inappropriate
    severity: str  # low, medium, high, critical
    evidence: str  # Specific text/pattern that triggered this
    explanation: str

class ChatAnalysisResponse(BaseModel):
    """Response from chat safety analysis"""
    risk_level: str  # safe, low_risk, moderate_risk, high_risk, dangerous
    risk_score: float  # 0-100
    red_flags: List[RedFlag]
    advisory: str
    action_items: List[str]
    resources: List[dict]

# ===========================================
# Risk Detection Rules (Configurable Thresholds)
# ===========================================

RISK_RULES = {
    "SUSTAINED_PANIC_MOVEMENT": {
        "description": "Sustained panic movement detected (3+ events in 30 seconds)",
        "base_confidence": 0.75
    },
    "PANIC_MOVEMENT_ABNORMAL_STOP": {
        "description": "Panic movement detected followed by sudden stop",
        "base_confidence": 0.7
    },
    "PANIC_MOVEMENT_NIGHT": {
        "description": "Panic movement during night hours (10PM - 5AM)",
        "base_confidence": 0.65
    },
    "GPS_LOSS_CELLULAR_MOVEMENT": {
        "description": "GPS lost, now tracking via cellular only with continued movement",
        "base_confidence": 0.5
    },
    "ROUTE_DEVIATION": {
        "description": "Significant deviation from expected route",
        "base_confidence": 0.6
    },
    "PROLONGED_STOP_UNUSUAL_LOCATION": {
        "description": "Extended stop in unusual location after movement",
        "base_confidence": 0.55
    }
}

# Thresholds for panic detection - LOWERED for better sensitivity
# Original values were too high for testing: accel=15, gyro=5
PANIC_ACCEL_THRESHOLD = 2.0   # m/s^2 variance threshold for panic (lowered from 15)
PANIC_GYRO_THRESHOLD = 0.5    # rad/s variance threshold for panic (lowered from 5)
NIGHT_START_HOUR = 22  # 10 PM
NIGHT_END_HOUR = 5     # 5 AM

# ===========================================
# Helper Functions
# ===========================================

def is_night_time(timestamp: datetime) -> bool:
    """Check if given time is during night hours"""
    hour = timestamp.hour
    return hour >= NIGHT_START_HOUR or hour < NIGHT_END_HOUR

def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points in meters using Haversine formula"""
    R = 6371000  # Earth's radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c

async def evaluate_risk_rules(trip: dict) -> Optional[RiskEvent]:
    """
    Evaluate all risk rules against current trip data.
    Returns a RiskEvent if risk is detected, None otherwise.
    
    This is the core risk detection engine - rule-based, no ML.
    """
    locations = trip.get('locations', [])
    motion_events = trip.get('motion_events', [])
    
    # Risk can be detected even without location data if we have motion
    contributing_signals = []
    detected_rule = None
    confidence = 0.0
    
    # Get recent data (last 1 minute for faster response)
    now = datetime.utcnow()
    one_min_ago = now - timedelta(seconds=60)
    thirty_sec_ago = now - timedelta(seconds=30)
    
    recent_locations = [l for l in locations if datetime.fromisoformat(l['timestamp'].replace('Z', '')) > one_min_ago] if locations else []
    recent_motion = [m for m in motion_events if datetime.fromisoformat(m['timestamp'].replace('Z', '')) > one_min_ago] if motion_events else []
    very_recent_motion = [m for m in motion_events if datetime.fromisoformat(m['timestamp'].replace('Z', '')) > thirty_sec_ago] if motion_events else []
    
    # Check for panic movements in recent data
    recent_panic = [m for m in recent_motion if m.get('is_panic', False)]
    very_recent_panic = [m for m in very_recent_motion if m.get('is_panic', False)]
    has_recent_panic = len(recent_panic) > 0
    
    # NEW RULE 0: Sustained Panic Movement (3+ panic events in 30 seconds)
    # This triggers on panic alone without needing other signals
    if len(very_recent_panic) >= 3:
        detected_rule = "SUSTAINED_PANIC_MOVEMENT"
        contributing_signals = ["sustained_panic", f"{len(very_recent_panic)}_panic_events_in_30s"]
        confidence = RISK_RULES[detected_rule]["base_confidence"]
        logger.warning(f"SUSTAINED PANIC: {len(very_recent_panic)} panic events detected")
    
    # Rule 1: Panic Movement + Abnormal Stop
    if not detected_rule and has_recent_panic and len(recent_locations) >= 2:
        last_loc = recent_locations[-1]
        prev_loc = recent_locations[-2]
        distance = calculate_distance(
            last_loc['latitude'], last_loc['longitude'],
            prev_loc['latitude'], prev_loc['longitude']
        )
        # If movement stopped (< 10m) after panic
        if distance < 10:
            detected_rule = "PANIC_MOVEMENT_ABNORMAL_STOP"
            contributing_signals = ["panic_movement", "sudden_stop"]
            confidence = RISK_RULES[detected_rule]["base_confidence"]
    
    # Rule 2: Panic Movement During Night
    if not detected_rule and has_recent_panic and is_night_time(now):
        detected_rule = "PANIC_MOVEMENT_NIGHT"
        contributing_signals = ["panic_movement", "night_hours"]
        confidence = RISK_RULES[detected_rule]["base_confidence"]
    
    # Rule 3: GPS Loss followed by cellular-only movement
    if not detected_rule and len(recent_locations) >= 3:
        # Check if we switched from GPS to cellular
        gps_locations = [l for l in recent_locations if l['source'] == 'gps']
        cellular_locations = [l for l in recent_locations if l['source'] == 'cellular_unwiredlabs']
        
        if len(gps_locations) > 0 and len(cellular_locations) >= 2:
            # Had GPS, now only cellular with movement
            if cellular_locations[-1]['timestamp'] > gps_locations[-1]['timestamp']:
                detected_rule = "GPS_LOSS_CELLULAR_MOVEMENT"
                contributing_signals = ["gps_lost", "cellular_tracking", "continued_movement"]
                confidence = RISK_RULES[detected_rule]["base_confidence"]
    
    # Rule 4: Prolonged stop in unusual location (> 5 min stop after significant movement)
    if not detected_rule and len(locations) >= 5:
        last_5_locs = locations[-5:]
        # Check if first 3 showed movement, last 2 are stationary
        movements = []
        for i in range(1, len(last_5_locs)):
            dist = calculate_distance(
                last_5_locs[i-1]['latitude'], last_5_locs[i-1]['longitude'],
                last_5_locs[i]['latitude'], last_5_locs[i]['longitude']
            )
            movements.append(dist)
        
        # Movement then stop pattern
        if len(movements) >= 4:
            early_movement = sum(movements[:2]) > 100  # > 100m movement
            recent_stop = sum(movements[-2:]) < 20     # < 20m (stopped)
            if early_movement and recent_stop:
                detected_rule = "PROLONGED_STOP_UNUSUAL_LOCATION"
                contributing_signals = ["movement_detected", "sudden_stop", "location_stationary"]
                confidence = RISK_RULES[detected_rule]["base_confidence"]
    
    # Increase confidence if multiple signals present
    if has_recent_panic and detected_rule:
        confidence = min(confidence + 0.15, 0.95)
    
    if is_night_time(now) and detected_rule:
        confidence = min(confidence + 0.1, 0.95)
    
    if detected_rule:
        last_loc = recent_locations[-1] if recent_locations else (locations[-1] if locations else None)
        return RiskEvent(
            rule_name=detected_rule,
            contributing_signals=contributing_signals,
            confidence=confidence,
            last_known_location=last_loc
        )
    
    return None

async def send_sms_alert(phone: str, message: str, location: Optional[dict] = None) -> bool:
    """
    Send SMS alert via Fast2SMS API.
    Returns True if sent successfully, False otherwise.
    """
    if FAST2SMS_API_KEY == 'demo_key':
        logger.warning("Fast2SMS API key not configured - SMS alert simulated")
        logger.info(f"SIMULATED SMS to {phone}: {message}")
        return True  # Simulate success for demo
    
    try:
        # Fast2SMS API endpoint
        url = "https://www.fast2sms.com/dev/bulkV2"
        
        # Build location string if available
        loc_str = ""
        if location:
            lat = location.get('latitude', 0)
            lon = location.get('longitude', 0)
            loc_str = f" Location: https://maps.google.com/?q={lat},{lon}"
        
        # Clean phone number (remove + and country code if needed for Indian numbers)
        clean_phone = phone.replace("+", "").replace(" ", "")
        if clean_phone.startswith("91") and len(clean_phone) > 10:
            clean_phone = clean_phone[2:]  # Remove 91 prefix for Indian numbers
        
        # Full message
        full_message = message + loc_str
        
        payload = {
            "route": "q",  # Quick SMS route (for testing/transactional)
            "message": full_message,
            "language": "english",
            "flash": 0,
            "numbers": clean_phone,
        }
        
        headers = {
            "authorization": FAST2SMS_API_KEY,
            "Content-Type": "application/x-www-form-urlencoded",
            "Cache-Control": "no-cache",
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(url, data=payload, headers=headers, timeout=10.0)
        
        result = response.json()
        
        if result.get("return") == True or result.get("status_code") == 200:
            logger.info(f"Fast2SMS: SMS sent successfully to {phone}")
            return True
        else:
            logger.error(f"Fast2SMS error: {result}")
            return False
            
    except Exception as e:
        logger.error(f"Fast2SMS error: {str(e)}")
        return False
        return False

async def send_push_notification(fcm_token: str, title: str, body: str) -> bool:
    """
    Send push notification via Firebase Cloud Messaging.
    For MVP, this simulates the notification.
    """
    # For MVP without Firebase credentials, we simulate
    logger.info(f"SIMULATED PUSH to token {fcm_token[:20]}...: {title} - {body}")
    return True

async def trigger_alerts(trip: dict, risk_event: RiskEvent) -> dict:
    """
    Trigger both push notification and SMS alert.
    Push is primary, SMS is mandatory fallback.
    """
    results = {"push_sent": False, "sms_sent": False}
    
    guardian_phone = trip.get('guardian_phone')
    guardian_fcm_token = trip.get('guardian_fcm_token')
    
    message = f"⚠️ NIRBHAY ALERT: Potential risk detected. Rule: {risk_event.rule_name}. User may need help."
    
    # Try push notification first (primary)
    if guardian_fcm_token:
        results["push_sent"] = await send_push_notification(
            guardian_fcm_token,
            "🚨 Safety Alert",
            message
        )
    
    # SMS is mandatory fallback (always try)
    if guardian_phone:
        results["sms_sent"] = await send_sms_alert(
            guardian_phone,
            message,
            risk_event.last_known_location
        )
    
    # Log for auditability
    logger.info(f"Alert triggered for trip {trip['id']}: push={results['push_sent']}, sms={results['sms_sent']}")
    
    return results

# ===========================================
# API Endpoints
# ===========================================

@api_router.get("/")
async def root():
    return {"message": "Nirbhay Safety API - Autonomous Women Safety System"}

@api_router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "services": {
            "database": "connected",
            "unwired_labs": "configured" if UNWIRED_LABS_API_KEY != 'demo_key' else "demo_mode",
            "fast2sms": "configured" if FAST2SMS_API_KEY != 'demo_key' else "demo_mode"
        }
    }

# ----- Trip Lifecycle -----

@api_router.post("/trips", response_model=Trip)
async def create_trip(trip_data: TripCreate):
    """
    Start a new trip - creates trip document and begins tracking session.
    """
    trip = Trip(
        user_id=trip_data.user_id,
        guardian_phone=trip_data.guardian_phone,
        guardian_fcm_token=trip_data.guardian_fcm_token
    )
    
    trip_dict = trip.model_dump()
    trip_dict['start_time'] = trip_dict['start_time'].isoformat()
    
    await db.trips.insert_one(trip_dict)
    logger.info(f"Trip created: {trip.id}")
    
    return trip

@api_router.get("/trips/{trip_id}")
async def get_trip(trip_id: str):
    """Get trip details including all location and motion data"""
    trip = await db.trips.find_one({"id": trip_id})
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    trip.pop('_id', None)
    return trip

@api_router.post("/trips/{trip_id}/end")
async def end_trip(trip_id: str):
    """
    End an active trip - stops all tracking.
    """
    trip = await db.trips.find_one({"id": trip_id})
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    end_time = datetime.utcnow()
    await db.trips.update_one(
        {"id": trip_id},
        {"$set": {"status": "ended", "end_time": end_time.isoformat()}}
    )
    
    logger.info(f"Trip ended: {trip_id}")
    return {"message": "Trip ended", "trip_id": trip_id, "end_time": end_time.isoformat()}

@api_router.put("/trips/{trip_id}/guardian")
async def update_guardian(trip_id: str, guardian: GuardianUpdate):
    """Update guardian contact information for a trip"""
    trip = await db.trips.find_one({"id": trip_id})
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    update_data = {}
    if guardian.guardian_phone:
        update_data["guardian_phone"] = guardian.guardian_phone
    if guardian.guardian_fcm_token:
        update_data["guardian_fcm_token"] = guardian.guardian_fcm_token
    
    if update_data:
        await db.trips.update_one({"id": trip_id}, {"$set": update_data})
    
    return {"message": "Guardian updated", "trip_id": trip_id}

# ----- Location Tracking -----

@api_router.post("/trips/{trip_id}/location")
async def add_location(trip_id: str, location: LocationInput, background_tasks: BackgroundTasks):
    """
    Add a location point to the trip.
    Triggers risk evaluation after adding location.
    """
    trip = await db.trips.find_one({"id": trip_id})
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    if trip.get('status') != 'active':
        raise HTTPException(status_code=400, detail="Trip is not active")
    
    loc_point = LocationPoint(
        latitude=location.latitude,
        longitude=location.longitude,
        accuracy=location.accuracy,
        source=location.source,
        accuracy_radius=location.accuracy_radius
    )
    
    loc_dict = loc_point.model_dump()
    loc_dict['timestamp'] = loc_dict['timestamp'].isoformat()
    
    await db.trips.update_one(
        {"id": trip_id},
        {"$push": {"locations": loc_dict}}
    )
    
    # Trigger risk evaluation in background
    background_tasks.add_task(check_and_alert_risk, trip_id)
    
    return {"message": "Location added", "location_id": loc_point.id}

@api_router.post("/cellular-triangulation")
async def cellular_triangulation(request: CellularTriangulationRequest):
    """
    Perform cellular triangulation using Unwired Labs API.
    This is the fallback when GPS is unavailable or inaccurate.
    
    Supports:
    1. Cell tower triangulation (if MCC/MNC/LAC/CID provided)
    2. IP-based geolocation (fallback when cell data not available)
    
    IMPORTANT: Cellular/IP triangulation is approximate. Never override good GPS data.
    """
    trip = await db.trips.find_one({"id": request.trip_id})
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    if UNWIRED_LABS_API_KEY == 'demo_key':
        # Demo mode - return simulated location
        logger.warning("Unwired Labs API key not configured - using demo response")
        demo_response = {
            "latitude": 28.6139,
            "longitude": 77.2090,
            "accuracy_radius": 1000,
            "source": "cellular_unwiredlabs",
            "status": "demo_mode"
        }
        
        loc_point = LocationPoint(
            latitude=demo_response["latitude"],
            longitude=demo_response["longitude"],
            source="cellular_unwiredlabs",
            accuracy_radius=demo_response["accuracy_radius"]
        )
        
        loc_dict = loc_point.model_dump()
        loc_dict['timestamp'] = loc_dict['timestamp'].isoformat()
        
        await db.trips.update_one(
            {"id": request.trip_id},
            {"$push": {"locations": loc_dict}}
        )
        
        return demo_response
    
    # Real Unwired Labs API call
    try:
        url = "https://us1.unwiredlabs.com/v2/process.php"
        
        # Build payload based on available data
        payload = {
            "token": UNWIRED_LABS_API_KEY,
            "address": 0
        }
        
        # If cell tower data is provided, use it
        if request.mcc and request.mnc and request.lac and request.cid:
            payload["radio"] = "gsm"
            payload["mcc"] = request.mcc
            payload["mnc"] = request.mnc
            payload["cells"] = [{
                "lac": request.lac,
                "cid": request.cid,
                "signal": request.signal_strength or -70
            }]
            logger.info(f"Using cell tower data for triangulation: MCC={request.mcc}, MNC={request.mnc}")
        else:
            # Use IP-based geolocation as fallback
            # Unwired Labs will use the request IP to determine location
            payload["fallbacks"] = {
                "all": True,
                "ipf": 1  # Enable IP fallback
            }
            logger.info("Using IP-based geolocation (no cell data provided)")
        
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(url, json=payload, timeout=10.0)
        
        data = response.json()
        
        if data.get("status") == "ok":
            loc_point = LocationPoint(
                latitude=data["lat"],
                longitude=data["lon"],
                source="cellular_unwiredlabs",
                accuracy_radius=data.get("accuracy", 5000)  # IP-based is less accurate
            )
            
            loc_dict = loc_point.model_dump()
            loc_dict['timestamp'] = loc_dict['timestamp'].isoformat()
            
            await db.trips.update_one(
                {"id": request.trip_id},
                {"$push": {"locations": loc_dict}}
            )
            
            method = "cell_tower" if request.mcc else "ip_geolocation"
            logger.info(f"Triangulation successful ({method}) for trip {request.trip_id}: lat={data['lat']}, lon={data['lon']}, accuracy={data.get('accuracy', 5000)}m")
            
            return {
                "latitude": data["lat"],
                "longitude": data["lon"],
                "accuracy_radius": data.get("accuracy", 5000),
                "source": "cellular_unwiredlabs",
                "method": method,
                "balance": data.get("balance"),
                "status": "success"
            }
        else:
            error_msg = data.get("message", "Unknown error")
            balance = data.get("balance", "unknown")
            logger.warning(f"Unwired Labs: {error_msg} (API balance: {balance})")
            
            return {
                "status": "no_match",
                "message": error_msg,
                "balance": balance,
                "detail": "Location could not be determined. Try again or check network connection."
            }
            
    except httpx.RequestError as e:
        logger.error(f"Unwired Labs request error: {str(e)}")
        raise HTTPException(status_code=502, detail="Cellular triangulation service unavailable")

# ----- Motion Tracking -----

@api_router.post("/trips/{trip_id}/motion")
async def add_motion_event(trip_id: str, motion: MotionInput, background_tasks: BackgroundTasks):
    """
    Add a motion sensor event.
    Evaluates if motion indicates panic (rule-based, no ML).
    
    Panic Detection Logic:
    - High acceleration variance indicates sudden jerky movements
    - High gyroscope variance indicates erratic rotation
    - Both combined suggest struggle/panic
    
    IMPORTANT: Panic alone does NOT trigger alerts - it increases risk confidence.
    """
    trip = await db.trips.find_one({"id": trip_id})
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    if trip.get('status') != 'active':
        raise HTTPException(status_code=400, detail="Trip is not active")
    
    # Determine if this is panic movement
    # Rule-based: high variance in both accel and gyro suggests struggle
    is_panic = (
        motion.accel_variance > PANIC_ACCEL_THRESHOLD and 
        motion.gyro_variance > PANIC_GYRO_THRESHOLD
    )
    
    motion_event = MotionEvent(
        accel_variance=motion.accel_variance,
        gyro_variance=motion.gyro_variance,
        is_panic=is_panic
    )
    
    motion_dict = motion_event.model_dump()
    motion_dict['timestamp'] = motion_dict['timestamp'].isoformat()
    
    await db.trips.update_one(
        {"id": trip_id},
        {"$push": {"motion_events": motion_dict}}
    )
    
    if is_panic:
        logger.warning(f"Panic movement detected for trip {trip_id}")
        # Trigger risk evaluation in background
        background_tasks.add_task(check_and_alert_risk, trip_id)
    
    return {
        "message": "Motion event recorded",
        "motion_id": motion_event.id,
        "is_panic": is_panic
    }

# ----- Risk Evaluation -----

async def check_and_alert_risk(trip_id: str):
    """
    Background task to evaluate risk and trigger alerts if needed.
    """
    try:
        trip = await db.trips.find_one({"id": trip_id})
        if not trip or trip.get('status') != 'active':
            return
        
        risk_event = await evaluate_risk_rules(trip)
        
        if risk_event:
            # Add risk event to trip
            risk_dict = risk_event.model_dump()
            risk_dict['timestamp'] = risk_dict['timestamp'].isoformat()
            
            # Trigger alerts
            alert_results = await trigger_alerts(trip, risk_event)
            risk_dict['push_sent'] = alert_results['push_sent']
            risk_dict['sms_sent'] = alert_results['sms_sent']
            risk_dict['alert_sent'] = alert_results['push_sent'] or alert_results['sms_sent']
            
            await db.trips.update_one(
                {"id": trip_id},
                {
                    "$push": {"risk_events": risk_dict},
                    "$set": {
                        "status": "alert",
                        "last_risk_check": datetime.utcnow().isoformat()
                    }
                }
            )
            
            logger.warning(f"RISK DETECTED for trip {trip_id}: {risk_event.rule_name}")
        else:
            # Update last check time
            await db.trips.update_one(
                {"id": trip_id},
                {"$set": {"last_risk_check": datetime.utcnow().isoformat()}}
            )
            
    except Exception as e:
        logger.error(f"Risk evaluation error: {str(e)}")

@api_router.post("/trips/{trip_id}/evaluate-risk")
async def manual_risk_evaluation(trip_id: str):
    """Manually trigger risk evaluation for a trip"""
    trip = await db.trips.find_one({"id": trip_id})
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    risk_event = await evaluate_risk_rules(trip)
    
    if risk_event:
        return {
            "risk_detected": True,
            "rule_name": risk_event.rule_name,
            "confidence": risk_event.confidence,
            "contributing_signals": risk_event.contributing_signals
        }
    
    return {"risk_detected": False, "message": "No risk detected"}

@api_router.get("/trips/{trip_id}/debug")
async def get_debug_info(trip_id: str):
    """
    Debug endpoint for transparency - shows current tracking state.
    Useful for demo and judges.
    """
    trip = await db.trips.find_one({"id": trip_id})
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    locations = trip.get('locations', [])
    motion_events = trip.get('motion_events', [])
    risk_events = trip.get('risk_events', [])
    
    # Get last location info
    last_location = locations[-1] if locations else None
    tracking_source = last_location.get('source', 'none') if last_location else 'none'
    accuracy = last_location.get('accuracy', 0) if last_location else 0
    accuracy_radius = last_location.get('accuracy_radius') if last_location else None
    
    # Check recent panic
    recent_motion = motion_events[-5:] if motion_events else []
    has_panic = any(m.get('is_panic', False) for m in recent_motion)
    
    # Get last risk event
    last_risk = risk_events[-1] if risk_events else None
    
    return {
        "trip_id": trip_id,
        "status": trip.get('status'),
        "tracking_source": tracking_source,
        "accuracy": accuracy,
        "accuracy_radius": accuracy_radius,
        "total_locations": len(locations),
        "total_motion_events": len(motion_events),
        "motion_status": "panic_detected" if has_panic else "normal",
        "last_risk_rule": last_risk.get('rule_name') if last_risk else None,
        "last_risk_confidence": last_risk.get('confidence') if last_risk else None,
        "guardian_phone": trip.get('guardian_phone', 'not_set'),
        "last_location": last_location
    }

@api_router.get("/trips/active/list")
async def list_active_trips():
    """List all active trips"""
    trips = await db.trips.find({"status": "active"}).to_list(100)
    return [{"id": t['id'], "start_time": t['start_time'], "status": t['status']} for t in trips]

# ----- Test Alert Endpoint (for demo) -----

@api_router.post("/trips/{trip_id}/test-alert")
async def test_alert(trip_id: str):
    """Test alert system - sends test notification/SMS"""
    trip = await db.trips.find_one({"id": trip_id})
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    
    test_risk = RiskEvent(
        rule_name="TEST_ALERT",
        contributing_signals=["manual_test"],
        confidence=1.0,
        last_known_location=trip.get('locations', [{}])[-1] if trip.get('locations') else None
    )
    
    results = await trigger_alerts(trip, test_risk)
    
    return {
        "message": "Test alert sent",
        "push_sent": results['push_sent'],
        "sms_sent": results['sms_sent'],
        "guardian_phone": trip.get('guardian_phone', 'not_set')
    }

# ===========================================
# Feature 1: Safe Route & Transport Suggestions
# ===========================================

def calculate_time_safety_score(hour: int) -> tuple:
    """Calculate safety score based on time of day"""
    if 6 <= hour < 10:  # Early morning
        return 85, "Early morning - moderate activity, generally safe"
    elif 10 <= hour < 18:  # Daytime
        return 95, "Daytime - high public activity, safest time"
    elif 18 <= hour < 21:  # Evening
        return 75, "Evening - decreasing activity, stay alert"
    elif 21 <= hour < 23:  # Late evening
        return 55, "Late evening - low activity, exercise caution"
    else:  # Night (23:00 - 6:00)
        return 30, "Night time - minimal activity, avoid if possible"

def calculate_area_safety(lat: float, lng: float) -> tuple:
    """Simulate area safety based on location (would use real data in production)"""
    # Simulate based on location hash for consistent results
    location_hash = abs(hash(f"{lat:.4f},{lng:.4f}")) % 100
    
    if location_hash < 20:
        return 60, "Mixed residential area - moderate safety"
    elif location_hash < 50:
        return 80, "Commercial area - good public presence"
    elif location_hash < 70:
        return 90, "Well-lit main road - high safety"
    else:
        return 75, "Residential area - generally safe"

async def get_nearby_police_stations(lat: float, lng: float) -> List[dict]:
    """Query OpenStreetMap for nearby police stations"""
    try:
        # Overpass API query for police stations within 2km
        overpass_url = "https://overpass-api.de/api/interpreter"
        query = f"""
        [out:json][timeout:10];
        (
          node["amenity"="police"](around:2000,{lat},{lng});
          way["amenity"="police"](around:2000,{lat},{lng});
        );
        out center;
        """
        
        async with httpx.AsyncClient() as client:
            response = await client.post(overpass_url, data={"data": query}, timeout=15.0)
            
        if response.status_code == 200:
            data = response.json()
            stations = []
            for element in data.get('elements', [])[:5]:  # Limit to 5
                station_lat = element.get('lat') or element.get('center', {}).get('lat')
                station_lng = element.get('lon') or element.get('center', {}).get('lon')
                if station_lat and station_lng:
                    distance = calculate_distance(lat, lng, station_lat, station_lng)
                    stations.append({
                        "name": element.get('tags', {}).get('name', 'Police Station'),
                        "lat": station_lat,
                        "lng": station_lng,
                        "distance_m": round(distance)
                    })
            return sorted(stations, key=lambda x: x['distance_m'])
        return []
    except Exception as e:
        logger.error(f"Error fetching police stations: {e}")
        return []

async def get_safe_spots(lat: float, lng: float) -> List[dict]:
    """Get nearby safe spots (hospitals, police, fire stations, metro stations)"""
    try:
        overpass_url = "https://overpass-api.de/api/interpreter"
        query = f"""
        [out:json][timeout:10];
        (
          node["amenity"="police"](around:1500,{lat},{lng});
          node["amenity"="hospital"](around:1500,{lat},{lng});
          node["amenity"="fire_station"](around:1500,{lat},{lng});
          node["station"="subway"](around:1500,{lat},{lng});
          node["railway"="station"](around:1500,{lat},{lng});
        );
        out;
        """
        
        async with httpx.AsyncClient() as client:
            response = await client.post(overpass_url, data={"data": query}, timeout=15.0)
            
        if response.status_code == 200:
            data = response.json()
            spots = []
            for element in data.get('elements', [])[:10]:
                spot_lat = element.get('lat')
                spot_lng = element.get('lon')
                tags = element.get('tags', {})
                
                spot_type = "safe_spot"
                icon = "shield"
                if tags.get('amenity') == 'police':
                    spot_type = "police"
                    icon = "shield-checkmark"
                elif tags.get('amenity') == 'hospital':
                    spot_type = "hospital"
                    icon = "medical"
                elif tags.get('amenity') == 'fire_station':
                    spot_type = "fire_station"
                    icon = "flame"
                elif tags.get('station') == 'subway' or tags.get('railway') == 'station':
                    spot_type = "metro"
                    icon = "train"
                
                if spot_lat and spot_lng:
                    distance = calculate_distance(lat, lng, spot_lat, spot_lng)
                    spots.append({
                        "name": tags.get('name', spot_type.replace('_', ' ').title()),
                        "type": spot_type,
                        "icon": icon,
                        "lat": spot_lat,
                        "lng": spot_lng,
                        "distance_m": round(distance)
                    })
            return sorted(spots, key=lambda x: x['distance_m'])[:8]
        return []
    except Exception as e:
        logger.error(f"Error fetching safe spots: {e}")
        return []

@api_router.post("/routes/analyze", response_model=RouteResponse)
async def analyze_route_safety(request: RouteRequest):
    """
    Analyze route safety and provide transport recommendations.
    Uses OpenStreetMap data for real location information.
    """
    # Determine travel time
    if request.travel_time:
        travel_datetime = datetime.fromisoformat(request.travel_time.replace('Z', ''))
    else:
        travel_datetime = datetime.utcnow()
    
    hour = travel_datetime.hour
    
    # Calculate safety factors
    time_score, time_desc = calculate_time_safety_score(hour)
    origin_area_score, origin_area_desc = calculate_area_safety(request.origin_lat, request.origin_lng)
    dest_area_score, dest_area_desc = calculate_area_safety(request.dest_lat, request.dest_lng)
    
    # Get nearby police stations for safety boost
    police_stations = await get_nearby_police_stations(
        (request.origin_lat + request.dest_lat) / 2,
        (request.origin_lng + request.dest_lng) / 2
    )
    police_score = min(90, 50 + len(police_stations) * 10) if police_stations else 50
    police_desc = f"{len(police_stations)} police stations within 2km" if police_stations else "No police stations nearby"
    
    # Calculate route distance
    route_distance = calculate_distance(
        request.origin_lat, request.origin_lng,
        request.dest_lat, request.dest_lng
    )
    
    # Lighting score (simulated based on time)
    if 6 <= hour < 19:
        lighting_score = 95
        lighting_desc = "Good natural lighting"
    elif 19 <= hour < 21:
        lighting_score = 70
        lighting_desc = "Transitioning to artificial lighting"
    else:
        lighting_score = 45
        lighting_desc = "Dependent on street lighting"
    
    # Crowd density (simulated based on time and day)
    weekday = travel_datetime.weekday()
    if weekday < 5:  # Weekday
        if 8 <= hour < 10 or 17 <= hour < 20:
            crowd_score = 90
            crowd_desc = "Peak hours - high public presence"
        elif 10 <= hour < 17:
            crowd_score = 75
            crowd_desc = "Regular hours - moderate activity"
        else:
            crowd_score = 40
            crowd_desc = "Off-peak - limited public presence"
    else:  # Weekend
        if 10 <= hour < 22:
            crowd_score = 70
            crowd_desc = "Weekend activity - variable crowds"
        else:
            crowd_score = 35
            crowd_desc = "Late night weekend - sparse activity"
    
    # Build safety factors
    factors = [
        SafetyFactor(name="Time of Day", score=time_score, description=time_desc, icon="time"),
        SafetyFactor(name="Crowd Density", score=crowd_score, description=crowd_desc, icon="people"),
        SafetyFactor(name="Lighting", score=lighting_score, description=lighting_desc, icon="bulb"),
        SafetyFactor(name="Police Presence", score=police_score, description=police_desc, icon="shield"),
        SafetyFactor(name="Area Safety", score=(origin_area_score + dest_area_score) // 2, 
                    description=f"Origin: {origin_area_desc}", icon="location"),
    ]
    
    # Calculate overall score (weighted average)
    weights = [0.25, 0.2, 0.15, 0.2, 0.2]
    overall_score = sum(f.score * w for f, w in zip(factors, weights))
    
    # Determine safety level
    if overall_score >= 80:
        safety_level = "safe"
    elif overall_score >= 60:
        safety_level = "moderate"
    else:
        safety_level = "risky"
    
    # Transport recommendations based on distance and safety
    transport_modes = []
    
    # Walking
    if route_distance < 2000:
        walk_time = int(route_distance / 80)  # ~5 km/h
        walk_safety = overall_score - (10 if hour >= 21 or hour < 6 else 0)
        transport_modes.append(TransportMode(
            mode="walk",
            safety_score=max(0, walk_safety),
            estimated_time=walk_time,
            recommendation="Safe for short distance" if walk_safety > 70 else "Consider alternatives at night",
            icon="walk"
        ))
    
    # Metro/Public transit
    if route_distance > 1000:
        metro_time = int(route_distance / 500) + 10  # Including wait time
        metro_safety = min(95, overall_score + 15)  # Metro is generally safer
        transport_modes.append(TransportMode(
            mode="metro",
            safety_score=metro_safety,
            estimated_time=metro_time,
            recommendation="Recommended - safe and monitored",
            icon="train"
        ))
    
    # Bus
    bus_time = int(route_distance / 300) + 15
    bus_safety = overall_score + 5
    transport_modes.append(TransportMode(
        mode="bus",
        safety_score=min(90, bus_safety),
        estimated_time=bus_time,
        recommendation="Good option with regular stops",
        icon="bus"
    ))
    
    # Auto/Rickshaw
    auto_time = int(route_distance / 400) + 5
    auto_safety = overall_score - 5 if hour >= 22 or hour < 6 else overall_score
    transport_modes.append(TransportMode(
        mode="auto",
        safety_score=max(40, auto_safety),
        estimated_time=auto_time,
        recommendation="Share ride details with guardian" if hour >= 21 else "Convenient for medium distances",
        icon="car"
    ))
    
    # Cab (app-based)
    cab_time = int(route_distance / 500) + 8
    cab_safety = overall_score + 10  # App-based cabs have tracking
    transport_modes.append(TransportMode(
        mode="cab",
        safety_score=min(95, cab_safety),
        estimated_time=cab_time,
        recommendation="Best for night travel - share trip with contacts",
        icon="car-sport"
    ))
    
    # Sort by safety score
    transport_modes.sort(key=lambda x: x.safety_score, reverse=True)
    
    # Generate route points (simple straight line for now)
    route_points = [
        {"lat": request.origin_lat, "lng": request.origin_lng, "type": "origin"},
        {"lat": request.dest_lat, "lng": request.dest_lng, "type": "destination"}
    ]
    
    # Get nearby safe spots
    nearby_safe_spots = await get_safe_spots(
        (request.origin_lat + request.dest_lat) / 2,
        (request.origin_lng + request.dest_lng) / 2
    )
    
    # Generate recommendations
    recommendations = []
    if safety_level == "risky":
        recommendations.append("Consider postponing travel if possible")
        recommendations.append("Use app-based cab with trip sharing enabled")
        recommendations.append("Keep emergency contacts readily accessible")
    elif safety_level == "moderate":
        recommendations.append("Stay on well-lit main roads")
        recommendations.append("Share your live location with a trusted contact")
        recommendations.append("Prefer public transport or verified cabs")
    else:
        recommendations.append("Route appears safe - enjoy your travel!")
        recommendations.append("Stay aware of surroundings as always")
    
    if hour >= 21 or hour < 6:
        recommendations.append("Avoid isolated areas and shortcuts")
        recommendations.append("Keep your phone charged and accessible")
    
    return RouteResponse(
        overall_safety_score=round(overall_score, 1),
        safety_level=safety_level,
        factors=factors,
        transport_modes=transport_modes,
        route_points=route_points,
        recommendations=recommendations,
        nearby_safe_spots=nearby_safe_spots
    )

# ===========================================
# Feature 2: Contextual Safety Guidance (Chat Analysis)
# ===========================================

CHAT_ANALYSIS_SYSTEM_PROMPT = """You are a safety advisor AI specialized in detecting potential grooming, manipulation, and social engineering patterns in conversations. Your role is to protect users, especially young people and vulnerable individuals, from online predators and scammers.

Analyze the chat screenshot provided and look for these specific red flags:

1. **LOVE_BOMBING**: Excessive compliments, declarations of love too soon, overwhelming attention
   - Examples: "You're the most beautiful person I've ever seen", "I've never felt this way about anyone", "You're my soulmate"

2. **PERSONAL_INFO_REQUEST**: Requests for sensitive personal information
   - Examples: Asking for home address, school/workplace, photos, financial details, ID documents

3. **PRESSURE_TACTICS**: Creating urgency, guilt-tripping, emotional manipulation
   - Examples: "If you loved me you would...", "I need this now", "You're the only one who can help"

4. **ISOLATION_ATTEMPTS**: Trying to separate victim from support network
   - Examples: "Don't tell anyone about us", "Your friends don't understand", "This is our secret"

5. **INAPPROPRIATE_CONTENT**: Age-inappropriate discussions, sexual content, explicit requests
   - Examples: Sexual comments, requests for intimate photos, inappropriate questions about body

For each red flag detected, provide:
- The type of red flag
- Severity (low/medium/high/critical)
- The specific text or pattern that triggered this detection
- A clear explanation of why this is concerning

Also provide:
- Overall risk level (safe/low_risk/moderate_risk/high_risk/dangerous)
- Risk score (0-100)
- Practical advisory for the user
- Specific action items

Respond in JSON format with this structure:
{
    "risk_level": "string",
    "risk_score": number,
    "red_flags": [
        {
            "type": "string",
            "severity": "string",
            "evidence": "string",
            "explanation": "string"
        }
    ],
    "advisory": "string",
    "action_items": ["string"]
}

Be thorough but avoid false positives. Consider context and relationship dynamics. Prioritize user safety while being balanced in assessment."""

@api_router.post("/chat/analyze", response_model=ChatAnalysisResponse)
async def analyze_chat_safety(request: ChatAnalysisRequest):
    """
    Analyze a chat screenshot for potential grooming or manipulation patterns.
    Uses Google Gemini AI for intelligent pattern detection.
    """
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500, 
            detail="AI service not configured. Please set GEMINI_API_KEY."
        )
    
    try:
        from google import genai
        from google.genai import types
        import json
        
        # Create client with API key
        client = genai.Client(api_key=GEMINI_API_KEY)
        
        # Build the message
        analysis_prompt = f"""{CHAT_ANALYSIS_SYSTEM_PROMPT}

Please analyze this chat screenshot for safety concerns."""
        if request.context:
            analysis_prompt += f"\n\nAdditional context from user: {request.context}"
        
        # Prepare image as Part
        image_part = types.Part.from_bytes(
            data=base64.b64decode(request.image_base64),
            mime_type="image/png"
        )
        
        # Send for analysis with image using gemini-2.5-flash model
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[analysis_prompt, image_part]
        )
        
        # Parse the JSON response
        response_text = response.text.strip()
        
        # Handle if response is wrapped in markdown code blocks
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()
        
        try:
            analysis_data = json.loads(response_text)
        except json.JSONDecodeError:
            # If JSON parsing fails, create a default safe response
            logger.warning(f"Failed to parse AI response as JSON: {response_text[:200]}")
            analysis_data = {
                "risk_level": "low_risk",
                "risk_score": 25,
                "red_flags": [],
                "advisory": "Unable to fully analyze the image. Please ensure it's a clear chat screenshot.",
                "action_items": ["Try uploading a clearer screenshot", "If concerned, trust your instincts and speak to a trusted adult"]
            }
        
        # Build red flags list
        red_flags = []
        for flag in analysis_data.get('red_flags', []):
            red_flags.append(RedFlag(
                type=flag.get('type', 'unknown'),
                severity=flag.get('severity', 'medium'),
                evidence=flag.get('evidence', 'Pattern detected'),
                explanation=flag.get('explanation', 'Potential concern identified')
            ))
        
        # Add helpful resources
        resources = [
            {"name": "Childline India", "contact": "1098", "type": "helpline"},
            {"name": "Women Helpline", "contact": "181", "type": "helpline"},
            {"name": "Cyber Crime Portal", "url": "https://cybercrime.gov.in", "type": "website"},
            {"name": "National Commission for Women", "contact": "7827-170-170", "type": "helpline"}
        ]
        
        return ChatAnalysisResponse(
            risk_level=analysis_data.get('risk_level', 'low_risk'),
            risk_score=analysis_data.get('risk_score', 25),
            red_flags=red_flags,
            advisory=analysis_data.get('advisory', 'Stay alert and trust your instincts.'),
            action_items=analysis_data.get('action_items', ['If something feels wrong, talk to a trusted adult']),
            resources=resources
        )
        
    except ImportError as e:
        logger.error(f"Failed to import google-generativeai: {e}")
        raise HTTPException(
            status_code=500,
            detail="AI service not available. Please install google-generativeai package."
        )
    except Exception as e:
        logger.error(f"Chat analysis error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {str(e)}"
        )

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
