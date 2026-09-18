import pandas as pd
import joblib
import json
import numpy as np
import os

def generate_parity_data():
    df = pd.read_csv("apps/relay/ml-training/data/test_set.csv")
    vectorizer = joblib.load("apps/relay/ml-training/vectorizer.pkl")
    calibrated_model = joblib.load("apps/relay/ml-training/model_calibrated.pkl")
    
    samples = df.head(15).copy()
    
    X = vectorizer.transform(samples['email_text'])
    y_proba = calibrated_model.predict_proba(X)
    
    classes = calibrated_model.classes_
    
    test_data = []
    for i, row in enumerate(samples.itertuples()):
        text = row.email_text
        probs = y_proba[i]
        
        prob_dict = {classes[j]: float(probs[j]) for j in range(len(classes))}
        
        test_data.append({
            "text": text,
            "expected_probabilities": prob_dict
        })
        
    with open("apps/relay/ml-training/parity_test_data.json", "w") as f:
        json.dump(test_data, f, indent=2)
        
    print("Generated apps/relay/ml-training/parity_test_data.json")

if __name__ == "__main__":
    generate_parity_data()
