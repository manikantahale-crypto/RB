import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
import joblib
import os

def train_model():
    print("Loading dataset...")
    df = pd.read_csv("apps/relay/ml-training/data/dataset.csv")
    
    # Time-based split: train on older 80%, test on newest 20%
    # Data is already sorted by created_at in our mock generator
    split_idx = int(len(df) * 0.8)
    train_df = df.iloc[:split_idx]
    test_df = df.iloc[split_idx:]
    
    print(f"Training on {len(train_df)} samples, testing on {len(test_df)} samples.")
    
    # TF-IDF Vectorizer
    # Default token pattern in sklearn is r"(?u)\b\w\w+\b" (lowercase, drop single-char tokens)
    vectorizer = TfidfVectorizer(lowercase=True)
    X_train = vectorizer.fit_transform(train_df['email_text'])
    y_train = train_df['label']
    
    X_test = vectorizer.transform(test_df['email_text'])
    y_test = test_df['label']
    
    print("Training Logistic Regression with class_weight='balanced'...")
    model = LogisticRegression(class_weight='balanced', max_iter=1000)
    model.fit(X_train, y_train)
    
    print(f"Train Accuracy: {model.score(X_train, y_train):.4f}")
    print(f"Test Accuracy: {model.score(X_test, y_test):.4f}")
    
    # Save the uncalibrated model and vectorizer for the next steps
    joblib.dump(vectorizer, "apps/relay/ml-training/vectorizer.pkl")
    joblib.dump(model, "apps/relay/ml-training/model_uncalibrated.pkl")
    
    # Save test set for evaluation and calibration
    test_df.to_csv("apps/relay/ml-training/data/test_set.csv", index=False)
    print("Model trained and saved.")

if __name__ == "__main__":
    train_model()
