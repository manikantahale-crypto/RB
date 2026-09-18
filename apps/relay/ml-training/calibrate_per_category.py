import json
import numpy as np
from sklearn.metrics import precision_recall_curve
import pickle

def main():
    print("Loading advanced model and test data...")
    try:
        with open('advanced_model.pkl', 'rb') as f:
            pipeline = pickle.load(f)
        with open('parity_test_data.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print("Model or data not found. Run train_advanced.py first.")
        return

    X = [{'subject': item.get('subject', ''), 'body': item.get('body', '')} for item in data]
    y_true = np.array([item['label'] for item in data])
    
    print("Predicting probabilities on validation set...")
    y_probs = pipeline.predict_proba(X)
    classes = pipeline.classes_
    
    target_precision = 0.95
    per_category_thresholds = {}

    print(f"\nCalibrating per-category thresholds for {target_precision*100}% precision:\n")
    for idx, class_name in enumerate(classes):
        # Create binary labels for this specific class
        y_binary = (y_true == class_name).astype(int)
        
        # Get predicted probabilities for this class
        probs = y_probs[:, idx]
        
        # Calculate precision-recall curve
        precisions, recalls, thresholds = precision_recall_curve(y_binary, probs)
        
        # Find the lowest threshold where precision is >= target_precision
        # If model is never that precise, default to 0.85
        valid_idx = np.where(precisions >= target_precision)[0]
        if len(valid_idx) > 0 and len(valid_idx) < len(thresholds) + 1:
            best_idx = valid_idx[0]
            # Handle edge case where best_idx corresponds to precision 1.0 at prob 1.0
            if best_idx < len(thresholds):
                threshold = thresholds[best_idx]
            else:
                threshold = 0.85
        else:
            threshold = 0.85
            
        per_category_thresholds[class_name] = float(threshold)
        print(f"[{class_name}] Calibrated Threshold: {threshold:.3f}")

    print("\nSaving calibrated thresholds to per_category_thresholds.json...")
    with open('per_category_thresholds.json', 'w') as f:
        json.dump(per_category_thresholds, f, indent=2)
        
    print("Done! You can now use these thresholds in classify.ts instead of the global 0.72.")

if __name__ == "__main__":
    main()
