#!/usr/bin/env python3
"""
Backend API Testing for Nirbhay Women Safety App
Tests the newly implemented API endpoints:
1. Safe Route Analysis API
2. Chat Safety Analysis API  
3. Health Check API
"""

import asyncio
import httpx
import json
import base64
from datetime import datetime
import os
from pathlib import Path

# Get backend URL from frontend .env file
def get_backend_url():
    frontend_env_path = Path("/app/frontend/.env")
    if frontend_env_path.exists():
        with open(frontend_env_path, 'r') as f:
            for line in f:
                if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                    return line.split('=')[1].strip()
    return "http://localhost:8001"

BASE_URL = get_backend_url()
API_BASE = f"{BASE_URL}/api"

print(f"Testing backend at: {API_BASE}")

class TestResults:
    def __init__(self):
        self.results = []
        self.passed = 0
        self.failed = 0
    
    def add_result(self, test_name, passed, details="", error=""):
        self.results.append({
            "test": test_name,
            "passed": passed,
            "details": details,
            "error": error,
            "timestamp": datetime.now().isoformat()
        })
        if passed:
            self.passed += 1
        else:
            self.failed += 1
    
    def print_summary(self):
        print(f"\n{'='*60}")
        print(f"TEST SUMMARY")
        print(f"{'='*60}")
        print(f"Total Tests: {len(self.results)}")
        print(f"Passed: {self.passed}")
        print(f"Failed: {self.failed}")
        print(f"Success Rate: {(self.passed/len(self.results)*100):.1f}%")
        
        if self.failed > 0:
            print(f"\n{'='*60}")
            print(f"FAILED TESTS:")
            print(f"{'='*60}")
            for result in self.results:
                if not result["passed"]:
                    print(f"❌ {result['test']}")
                    print(f"   Error: {result['error']}")
                    print()

# Create a simple test image in base64 format
def create_test_image_base64():
    """Create a simple test image as base64 for chat analysis testing"""
    # This creates a minimal PNG image (1x1 pixel, transparent)
    # Real implementation would use actual chat screenshot
    png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00IEND\xaeB`\x82'
    return base64.b64encode(png_data).decode('utf-8')

async def test_health_check():
    """Test the health check endpoint"""
    test_results = TestResults()
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{API_BASE}/health")
            
            if response.status_code == 200:
                data = response.json()
                
                # Check required fields
                required_fields = ["status", "timestamp", "services"]
                missing_fields = [field for field in required_fields if field not in data]
                
                if missing_fields:
                    test_results.add_result(
                        "Health Check - Response Structure",
                        False,
                        error=f"Missing fields: {missing_fields}"
                    )
                else:
                    test_results.add_result(
                        "Health Check - Response Structure",
                        True,
                        details=f"All required fields present: {list(data.keys())}"
                    )
                
                # Check status
                if data.get("status") == "healthy":
                    test_results.add_result(
                        "Health Check - Status",
                        True,
                        details="Service reports healthy status"
                    )
                else:
                    test_results.add_result(
                        "Health Check - Status",
                        False,
                        error=f"Unexpected status: {data.get('status')}"
                    )
                
                # Check services
                services = data.get("services", {})
                expected_services = ["database", "unwired_labs", "fast2sms"]
                for service in expected_services:
                    if service in services:
                        test_results.add_result(
                            f"Health Check - {service} service",
                            True,
                            details=f"{service}: {services[service]}"
                        )
                    else:
                        test_results.add_result(
                            f"Health Check - {service} service",
                            False,
                            error=f"Service {service} not reported"
                        )
            else:
                test_results.add_result(
                    "Health Check - HTTP Status",
                    False,
                    error=f"Expected 200, got {response.status_code}: {response.text}"
                )
                
    except Exception as e:
        test_results.add_result(
            "Health Check - Connection",
            False,
            error=f"Failed to connect: {str(e)}"
        )
    
    return test_results

async def test_safe_route_analysis():
    """Test the safe route analysis endpoint"""
    test_results = TestResults()
    
    # Test data: Delhi coordinates as specified in the review request
    test_request = {
        "origin_lat": 28.6139,
        "origin_lng": 77.2090,
        "dest_lat": 28.6315,
        "dest_lng": 77.2167
    }
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{API_BASE}/routes/analyze",
                json=test_request
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Check required response fields
                required_fields = [
                    "overall_safety_score", "safety_level", "factors", 
                    "transport_modes", "recommendations"
                ]
                
                missing_fields = [field for field in required_fields if field not in data]
                
                if missing_fields:
                    test_results.add_result(
                        "Route Analysis - Response Structure",
                        False,
                        error=f"Missing fields: {missing_fields}"
                    )
                else:
                    test_results.add_result(
                        "Route Analysis - Response Structure",
                        True,
                        details=f"All required fields present"
                    )
                
                # Check overall_safety_score
                safety_score = data.get("overall_safety_score")
                if isinstance(safety_score, (int, float)) and 0 <= safety_score <= 100:
                    test_results.add_result(
                        "Route Analysis - Safety Score",
                        True,
                        details=f"Safety score: {safety_score}"
                    )
                else:
                    test_results.add_result(
                        "Route Analysis - Safety Score",
                        False,
                        error=f"Invalid safety score: {safety_score}"
                    )
                
                # Check safety_level
                safety_level = data.get("safety_level")
                valid_levels = ["safe", "moderate", "risky"]
                if safety_level in valid_levels:
                    test_results.add_result(
                        "Route Analysis - Safety Level",
                        True,
                        details=f"Safety level: {safety_level}"
                    )
                else:
                    test_results.add_result(
                        "Route Analysis - Safety Level",
                        False,
                        error=f"Invalid safety level: {safety_level}"
                    )
                
                # Check factors array
                factors = data.get("factors", [])
                if isinstance(factors, list) and len(factors) > 0:
                    test_results.add_result(
                        "Route Analysis - Safety Factors",
                        True,
                        details=f"Found {len(factors)} safety factors"
                    )
                    
                    # Check factor structure
                    for i, factor in enumerate(factors[:3]):  # Check first 3
                        required_factor_fields = ["name", "score", "description", "icon"]
                        missing_factor_fields = [f for f in required_factor_fields if f not in factor]
                        if missing_factor_fields:
                            test_results.add_result(
                                f"Route Analysis - Factor {i+1} Structure",
                                False,
                                error=f"Missing factor fields: {missing_factor_fields}"
                            )
                        else:
                            test_results.add_result(
                                f"Route Analysis - Factor {i+1} Structure",
                                True,
                                details=f"Factor: {factor['name']} (score: {factor['score']})"
                            )
                else:
                    test_results.add_result(
                        "Route Analysis - Safety Factors",
                        False,
                        error="No safety factors returned"
                    )
                
                # Check transport_modes array
                transport_modes = data.get("transport_modes", [])
                if isinstance(transport_modes, list) and len(transport_modes) > 0:
                    test_results.add_result(
                        "Route Analysis - Transport Modes",
                        True,
                        details=f"Found {len(transport_modes)} transport modes"
                    )
                    
                    # Check if sorted by safety_score (descending)
                    scores = [mode.get("safety_score", 0) for mode in transport_modes]
                    is_sorted = all(scores[i] >= scores[i+1] for i in range(len(scores)-1))
                    
                    if is_sorted:
                        test_results.add_result(
                            "Route Analysis - Transport Modes Sorting",
                            True,
                            details=f"Transport modes sorted by safety score: {scores}"
                        )
                    else:
                        test_results.add_result(
                            "Route Analysis - Transport Modes Sorting",
                            False,
                            error=f"Transport modes not sorted by safety score: {scores}"
                        )
                else:
                    test_results.add_result(
                        "Route Analysis - Transport Modes",
                        False,
                        error="No transport modes returned"
                    )
                
                # Check recommendations
                recommendations = data.get("recommendations", [])
                if isinstance(recommendations, list) and len(recommendations) > 0:
                    test_results.add_result(
                        "Route Analysis - Recommendations",
                        True,
                        details=f"Found {len(recommendations)} recommendations"
                    )
                else:
                    test_results.add_result(
                        "Route Analysis - Recommendations",
                        False,
                        error="No recommendations returned"
                    )
                    
            else:
                test_results.add_result(
                    "Route Analysis - HTTP Status",
                    False,
                    error=f"Expected 200, got {response.status_code}: {response.text}"
                )
                
    except Exception as e:
        test_results.add_result(
            "Route Analysis - Connection",
            False,
            error=f"Failed to connect: {str(e)}"
        )
    
    return test_results

async def test_chat_safety_analysis():
    """Test the chat safety analysis endpoint"""
    test_results = TestResults()
    
    # Create test request with base64 image
    test_image_base64 = create_test_image_base64()
    test_request = {
        "image_base64": test_image_base64,
        "context": "Testing chat safety analysis with a sample image"
    }
    
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:  # Longer timeout for AI processing
            response = await client.post(
                f"{API_BASE}/chat/analyze",
                json=test_request
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Check required response fields
                required_fields = [
                    "risk_level", "risk_score", "red_flags", 
                    "advisory", "action_items", "resources"
                ]
                
                missing_fields = [field for field in required_fields if field not in data]
                
                if missing_fields:
                    test_results.add_result(
                        "Chat Analysis - Response Structure",
                        False,
                        error=f"Missing fields: {missing_fields}"
                    )
                else:
                    test_results.add_result(
                        "Chat Analysis - Response Structure",
                        True,
                        details=f"All required fields present"
                    )
                
                # Check risk_level
                risk_level = data.get("risk_level")
                valid_risk_levels = ["safe", "low_risk", "moderate_risk", "high_risk", "dangerous"]
                if risk_level in valid_risk_levels:
                    test_results.add_result(
                        "Chat Analysis - Risk Level",
                        True,
                        details=f"Risk level: {risk_level}"
                    )
                else:
                    test_results.add_result(
                        "Chat Analysis - Risk Level",
                        False,
                        error=f"Invalid risk level: {risk_level}"
                    )
                
                # Check risk_score
                risk_score = data.get("risk_score")
                if isinstance(risk_score, (int, float)) and 0 <= risk_score <= 100:
                    test_results.add_result(
                        "Chat Analysis - Risk Score",
                        True,
                        details=f"Risk score: {risk_score}"
                    )
                else:
                    test_results.add_result(
                        "Chat Analysis - Risk Score",
                        False,
                        error=f"Invalid risk score: {risk_score}"
                    )
                
                # Check red_flags array
                red_flags = data.get("red_flags", [])
                if isinstance(red_flags, list):
                    test_results.add_result(
                        "Chat Analysis - Red Flags Array",
                        True,
                        details=f"Found {len(red_flags)} red flags"
                    )
                    
                    # Check red flag structure if any exist
                    if len(red_flags) > 0:
                        flag = red_flags[0]
                        required_flag_fields = ["type", "severity", "evidence", "explanation"]
                        missing_flag_fields = [f for f in required_flag_fields if f not in flag]
                        if missing_flag_fields:
                            test_results.add_result(
                                "Chat Analysis - Red Flag Structure",
                                False,
                                error=f"Missing red flag fields: {missing_flag_fields}"
                            )
                        else:
                            test_results.add_result(
                                "Chat Analysis - Red Flag Structure",
                                True,
                                details=f"Red flag structure valid: {flag['type']}"
                            )
                else:
                    test_results.add_result(
                        "Chat Analysis - Red Flags Array",
                        False,
                        error="Red flags is not an array"
                    )
                
                # Check advisory
                advisory = data.get("advisory")
                if isinstance(advisory, str) and len(advisory) > 0:
                    test_results.add_result(
                        "Chat Analysis - Advisory",
                        True,
                        details=f"Advisory provided: {advisory[:50]}..."
                    )
                else:
                    test_results.add_result(
                        "Chat Analysis - Advisory",
                        False,
                        error="No advisory provided"
                    )
                
                # Check action_items
                action_items = data.get("action_items", [])
                if isinstance(action_items, list) and len(action_items) > 0:
                    test_results.add_result(
                        "Chat Analysis - Action Items",
                        True,
                        details=f"Found {len(action_items)} action items"
                    )
                else:
                    test_results.add_result(
                        "Chat Analysis - Action Items",
                        False,
                        error="No action items provided"
                    )
                
                # Check resources
                resources = data.get("resources", [])
                if isinstance(resources, list) and len(resources) > 0:
                    test_results.add_result(
                        "Chat Analysis - Resources",
                        True,
                        details=f"Found {len(resources)} resources"
                    )
                else:
                    test_results.add_result(
                        "Chat Analysis - Resources",
                        False,
                        error="No resources provided"
                    )
                    
            elif response.status_code == 500:
                # Check if it's a configuration issue
                error_text = response.text
                if "AI service not configured" in error_text or "EMERGENT_LLM_KEY" in error_text:
                    test_results.add_result(
                        "Chat Analysis - Configuration",
                        False,
                        error="AI service not configured - EMERGENT_LLM_KEY missing or invalid"
                    )
                else:
                    test_results.add_result(
                        "Chat Analysis - Server Error",
                        False,
                        error=f"Server error: {error_text}"
                    )
            else:
                test_results.add_result(
                    "Chat Analysis - HTTP Status",
                    False,
                    error=f"Expected 200, got {response.status_code}: {response.text}"
                )
                
    except Exception as e:
        test_results.add_result(
            "Chat Analysis - Connection",
            False,
            error=f"Failed to connect: {str(e)}"
        )
    
    return test_results

async def main():
    """Run all backend tests"""
    print("Starting Nirbhay Backend API Tests...")
    print(f"Backend URL: {API_BASE}")
    print("="*60)
    
    all_results = TestResults()
    
    # Test 1: Health Check
    print("\n🔍 Testing Health Check API...")
    health_results = await test_health_check()
    all_results.results.extend(health_results.results)
    all_results.passed += health_results.passed
    all_results.failed += health_results.failed
    
    # Test 2: Safe Route Analysis
    print("\n🗺️  Testing Safe Route Analysis API...")
    route_results = await test_safe_route_analysis()
    all_results.results.extend(route_results.results)
    all_results.passed += route_results.passed
    all_results.failed += route_results.failed
    
    # Test 3: Chat Safety Analysis
    print("\n💬 Testing Chat Safety Analysis API...")
    chat_results = await test_chat_safety_analysis()
    all_results.results.extend(chat_results.results)
    all_results.passed += chat_results.passed
    all_results.failed += chat_results.failed
    
    # Print final summary
    all_results.print_summary()
    
    # Save detailed results to file
    with open('/app/test_reports/backend_test_results.json', 'w') as f:
        json.dump({
            "summary": {
                "total_tests": len(all_results.results),
                "passed": all_results.passed,
                "failed": all_results.failed,
                "success_rate": round(all_results.passed/len(all_results.results)*100, 1)
            },
            "results": all_results.results,
            "timestamp": datetime.now().isoformat()
        }, f, indent=2)
    
    print(f"\nDetailed results saved to: /app/test_reports/backend_test_results.json")
    
    return all_results

if __name__ == "__main__":
    asyncio.run(main())