import pandas as pd
import json
import random
from datetime import datetime, timedelta

def generate_mock_data(num_samples=1000):
    intents = [
        "Candidate Shortlisted",
        "Selected for Interview",
        "Interview Request",
        "Need Resume",
        "Rate Asked",
        "Requirement Shared",
        "Client Submission",
        "Vendor Reply",
        "Non-Vendor Email",
        "Follow-Up Needed",
        "Rejected",
        "Not Interested"
    ]
    
    # Simulate realistic class imbalances
    weights = [0.02, 0.02, 0.05, 0.1, 0.1, 0.3, 0.05, 0.1, 0.1, 0.06, 0.05, 0.05]
    
    templates = {
        "Candidate Shortlisted": [
            "We have shortlisted the candidate {name} for the position.",
            "Your profile for {role} has been short-listed.",
            "Shortlist confirmation for the java developer role."
        ],
        "Selected for Interview": [
            "The candidate has been selected for an interview.",
            "Please confirm if the candidate is available for an interview.",
            "Chosen for interview tomorrow at 10 AM."
        ],
        "Interview Request": [
            "Can we schedule a teams call with {name}?",
            "What are the available time slots for discussion?",
            "Please provide interview slot for the candidate."
        ],
        "Need Resume": [
            "Please send the updated resume.",
            "Can you share the consultant's latest profile?",
            "We need the resume copy to proceed."
        ],
        "Rate Asked": [
            "What is the expected hourly rate for this role?",
            "Please confirm the c2c rate.",
            "What is your billing rate?"
        ],
        "Requirement Shared": [
            "Please find the job description attached.",
            "Hot requirement: Senior React Developer.",
            "Looking for suitable profiles for this new opening."
        ],
        "Client Submission": [
            "We have submitted the profile to the client.",
            "Submission done for the candidate.",
            "I will submit the consultant's resume to our direct client."
        ],
        "Vendor Reply": [
            "Thanks for the update.",
            "We will get back to you shortly.",
            "I'll check with my team."
        ],
        "Non-Vendor Email": [
            "Hello, just checking in.",
            "When is the next sync up?",
            "General inquiry about your services."
        ],
        "Follow-Up Needed": [
            "Please confirm availability for a c2c role.",
            "Can you sign the rtr?",
            "Let me know when the candidate is free."
        ],
        "Rejected": [
            "The client has rejected this profile.",
            "Not moving forward with this candidate.",
            "Unfortunately, not a fit for this position."
        ],
        "Not Interested": [
            "Please remove me from your list.",
            "Not looking for a job right now.",
            "Stop sending these emails."
        ]
    }
    
    data = []
    base_date = datetime(2025, 1, 1)
    
    for i in range(num_samples):
        intent = random.choices(intents, weights=weights)[0]
        template = random.choice(templates[intent])
        
        # Add some random noise/words
        noise = random.choice(["", " Thanks.", " Best regards.", " Let me know.", " ASAP."])
        email_text = template.format(name="John Doe", role="Developer") + noise
        
        # Time-based: ensure dates are spread out
        date = base_date + timedelta(hours=i * 2)
        
        data.append({
            "email_text": email_text,
            "label": intent,
            "created_at": date.isoformat()
        })
        
    df = pd.DataFrame(data)
    # Ensure they are sorted by date
    df = df.sort_values("created_at")
    df.to_csv("apps/relay/ml-training/data/dataset.csv", index=False)
    print(f"Generated {len(df)} mock training samples at apps/relay/ml-training/data/dataset.csv")

if __name__ == "__main__":
    generate_mock_data(2000)
