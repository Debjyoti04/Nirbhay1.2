Here is a **clean, Windows-only `README.md`**, rewritten so there are **no Mac/Linux commands or references**, and everything works smoothly on **Windows 10/11**.

You can **copy-paste this directly as `README.md`**.

---

````markdown
# Nirbhay – Autonomous Women Safety System (Windows)

![Nirbhay Logo](frontend/assets/images/icon.png)

**Nirbhay** is an autonomous women-safety mobile application that detects unsafe travel or potential kidnapping **without any manual SOS action** and automatically alerts trusted guardians.

The system continuously monitors location and motion signals in the background and triggers alerts when abnormal behavior is detected.

---

## Core Philosophy

- **Autonomous > Manual SOS** – No button press required
- **Reliability > Precision** – False positives are acceptable for safety
- **Rule-based Detection** – No ML, fully explainable logic
- **Multi-signal Fusion** – GPS + motion sensors

---

## Features

### 1. Trip Lifecycle
- Start and end trips with a single tap
- Background GPS and motion tracking
- Guardian phone number configuration

### 2. GPS + Cellular Fallback
- High-accuracy GPS tracking (~15 meters)
- Automatic fallback to last known location when GPS is unavailable
- IP/Cellular-based geolocation using **Unwired Labs API**

### 3. Panic Movement Detection
- Accelerometer + gyroscope monitoring
- Rule-based panic detection (no ML)
- Configurable thresholds

### 4. Safety Check System
When panic movement is detected:
1. Phone vibrates and shows **“Are you feeling okay?”**
2. User has **20 seconds** to respond
3. If **Yes** → Enter safety code (`1234`)
4. If correct → Alert cancelled
5. If wrong / No / No response → **SMS alert sent automatically**

### 5. SMS Alerts (Fast2SMS)
- Automatic SMS to guardian containing:
  - Emergency alert message
  - Google Maps live location link
- Uses **Fast2SMS Quick API** (no DLT registration needed)

---

## Local Setup (Windows Only)

### Prerequisites
Make sure these are installed on **Windows**:

- **Node.js 18+**
- **Python 3.9+**
- **MongoDB** (local or Atlas)
- **Expo Go app** on your Android/iOS phone
- **Yarn** (`npm install -g yarn`)

---

## Backend Setup (Windows)

```bat
cd backend

:: Create virtual environment
python -m venv venv

:: Activate virtual environment
venv\Scripts\activate

:: Install dependencies
pip install fastapi uvicorn motor pydantic python-dotenv httpx

:: Start backend server
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
````

The backend will be running at:

```
http://localhost:8001
```

---

## Frontend Setup (Windows)

```bat
cd frontend

:: Install dependencies
yarn install

:: Start Expo
npx expo start --tunnel
```

---

## Run on Physical Device

1. Install **Expo Go** from Play Store / App Store
2. Run `npx expo start --tunnel`
3. Scan the QR code from Expo Go
4. Grant:

   * Location permission (Allow Always)
   * Motion & activity permission

---

## Testing the Safety System

1. Start a trip and set guardian phone number
2. Shake the phone vigorously for **5–10 seconds**
3. Safety check modal appears

### Test Scenarios

* Enter `1234` → Safe (alert cancelled)
* Enter wrong code → SMS alert sent
* No response for 20 seconds → SMS alert sent
* Tap **No** → SMS alert sent

---

## Backend `.env` (Windows)

Create a file named `.env` inside the `backend` folder:

```env
# MongoDB Connection
MONGO_URL="mongodb://localhost:27017"
DB_NAME="nirbhay_db"

# Unwired Labs API (Cellular / IP Geolocation)
# https://unwiredlabs.com/
UNWIRED_LABS_API_KEY=

# Fast2SMS API Key (SMS Alerts)
# https://www.fast2sms.com/
FAST2SMS_API_KEY=
```

---

## Frontend `.env` (Windows)

Create a file named `.env` inside the `frontend` folder.

First, find your local IP address:

```bat
ipconfig
```

Look for **IPv4 Address** (example: `192.168.1.100`)

```env
EXPO_PUBLIC_BACKEND_URL="http://YOUR_LOCAL_IP:8001"
```

### Example:

```env
EXPO_PUBLIC_BACKEND_URL="http://192.168.1.100:8001"
```

---

## Quick Windows Commands

```bat
:: Find local IP
ipconfig

:: Start MongoDB (if installed locally)
mongod

:: Start Backend
cd backend
venv\Scripts\activate
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

:: Start Frontend
cd frontend
npx expo start --tunnel
```

---

## Notes

* Keep phone screen **locked** to test background detection
* Disable battery optimization for Expo Go
* Ensure mobile and laptop are on the **same network**
* This system is **rule-based and explainable**, ideal for safety-critical demos and hackathons

---

## Project Status

This project is **prototype-ready** and suitable for:

* Hackathons
* Academic submissions
* MVP demonstrations
* Safety-tech showcases

---

**Nirbhay – Safety that doesn’t wait for permission.**

```

