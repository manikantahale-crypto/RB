import pandas as pd
import joblib
from sklearn.metrics import classification_report
import numpy as np

def evaluate_model():
    print("Loading test data and uncalibrated model...")
    test_df = pd.read_csv("apps/relay/ml-training/data/test_set.csv")
    vectorizer = joblib.load("apps/relay/ml-training/vectorizer.pkl")
    model = joblib.load("apps/relay/ml-training/model_uncalibrated.pkl")
    
    X_test = vectorizer.transform(test_df['email_text'])
    y_test = test_df['label']
    
    print("Evaluating Model...")
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)
    
    # Per-category precision/recall/F1
    print("\nClassification Report (Uncalibrated):")
    print(classification_report(y_test, y_pred))
    
    # Risk-coverage curve
    print("\nRisk-Coverage Table (Uncalibrated):")
    print(f"{'Threshold':<12} | {'Coverage %':<12} | {'Accuracy on Covered %':<25}")
    print("-" * 55)
    
    thresholds = np.arange(0.5, 1.0, 0.05)
    for threshold in thresholds:
        max_probs = np.max(y_proba, axis=1)
        covered_indices = max_probs >= threshold
        coverage = np.mean(covered_indices) * 100
        
        if np.sum(covered_indices) > 0:
            accuracy = np.mean(y_pred[covered_indices] == y_test.values[covered_indices]) * 100
        else:
            accuracy = 0.0
            
        print(f"{threshold:<12.2f} | {coverage:<12.1f} | {accuracy:<25.1f}")

if __name__ == "__main__":
    evaluate_model()
