"""
Integration test suite for Lyka Realty Ollama Chat & Property Recommendation API.
Tests endpoints and validates real dataset property matching without fabrication.
"""
import sys
import os
import unittest
import httpx

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

BASE_URL = "http://127.0.0.1:8000"


class TestChatIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Verify server is listening
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(f"{BASE_URL}/api/health")
            assert resp.status_code == 200, f"Backend health check failed: {resp.status_code}"

    def test_01_health_and_ollama_status(self):
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(f"{BASE_URL}/api/ollama/status")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertIn("status", data)
            self.assertEqual(data["status"], "online")
            self.assertTrue(data.get("model_available"), "Target model llama3.2:3b should be available")

    def test_02_property_dataset_search(self):
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(
                f"{BASE_URL}/api/properties/search",
                params={"location": "Dubai Marina", "bedrooms": 2, "max_budget": 2000000}
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertGreaterEqual(data["total_found"], 2)
            for p in data["top_properties"]:
                self.assertIn("Dubai Marina", p["location"])
                self.assertEqual(p["bhk"], 2)
                self.assertLessEqual(p["price_aed"], 2000000)

    def test_03_query_villa_under_3m(self):
        """Test Query: 'Find a villa in Dubai under AED 3 million'
        No Buy/Rent stated -> the bot must ask FIRST (no assumed listings),
        then return real villas once the purpose is answered."""
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(
                f"{BASE_URL}/api/chat",
                json={
                    "message": "Find a villa in Dubai under AED 3 million",
                    "session_id": "test-suite-villa",
                    "history": []
                }
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data["reply"], "Assistant must provide a reply")
            self.assertNotIn("Thinking", data["reply"])

            # Turn 1: clarification gate, nothing assumed
            self.assertEqual(data.get("need"), "purpose")
            self.assertEqual(data.get("options"), ["Buy", "Rent"])
            self.assertEqual(data.get("matched_properties", []), [])

            # Check requirements
            reqs = data.get("requirements", {})
            self.assertEqual(reqs.get("propertyType"), "Villa")
            self.assertEqual(reqs.get("budget"), 3000000)
            self.assertIsNone(reqs.get("purpose"), "Purpose must not be assumed")
            self.assertNotEqual(reqs.get("bhk"), 0, "Should not invent Studio (0 bhk) for villas")

            # Turn 2: answer Rent -> real matching villas
            resp2 = client.post(
                f"{BASE_URL}/api/chat",
                json={
                    "message": "Rent",
                    "session_id": "test-suite-villa",
                    "history": []
                }
            )
            self.assertEqual(resp2.status_code, 200)
            data2 = resp2.json()
            self.assertEqual(data2.get("requirements", {}).get("purpose"), "Rent")
            props = data2.get("matched_properties", [])
            self.assertGreaterEqual(len(props), 1, "Should find at least 1 villa in Dubai under 3M")
            for p in props:
                self.assertEqual(p["property_type"], "Villa")
                self.assertEqual(p["listing_type"], "Rent")
                self.assertLessEqual(p["price_aed"], 3000000)

    def test_04_query_2bed_apartment_marina_under_2m(self):
        """Test Query: 'Find a 2-bedroom apartment in Dubai Marina under AED 2 million'
        Same corrected flow: ask Buy/Rent first, then real listings."""
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(
                f"{BASE_URL}/api/chat",
                json={
                    "message": "Find a 2-bedroom apartment in Dubai Marina under AED 2 million",
                    "session_id": "test-suite-apt-marina",
                    "history": []
                }
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data["reply"], "Assistant must provide a reply")
            self.assertNotIn("Thinking", data["reply"])

            # Turn 1: clarification gate, nothing assumed
            self.assertEqual(data.get("need"), "purpose")
            self.assertEqual(data.get("matched_properties", []), [])

            # Check requirements
            reqs = data.get("requirements", {})
            self.assertEqual(reqs.get("location"), "Dubai Marina")
            self.assertEqual(reqs.get("propertyType"), "Apartment")
            self.assertEqual(reqs.get("bhk"), 2)
            self.assertEqual(reqs.get("budget"), 2000000)
            self.assertIsNone(reqs.get("purpose"), "Purpose must not be assumed")

            # Turn 2: answer Buy -> real matching apartments
            resp2 = client.post(
                f"{BASE_URL}/api/chat",
                json={
                    "message": "Buy",
                    "session_id": "test-suite-apt-marina",
                    "history": []
                }
            )
            self.assertEqual(resp2.status_code, 200)
            data2 = resp2.json()
            self.assertEqual(data2.get("requirements", {}).get("purpose"), "Sale")
            props = data2.get("matched_properties", [])
            self.assertGreaterEqual(len(props), 1, "Should find matching 2BHK apartments in Dubai Marina")
            for p in props:
                self.assertIn("Dubai Marina", p["location"])
                self.assertEqual(p["bhk"], 2)
                self.assertEqual(p["listing_type"], "Sale")
                self.assertLessEqual(p["price_aed"], 2000000)


if __name__ == "__main__":
    unittest.main()
