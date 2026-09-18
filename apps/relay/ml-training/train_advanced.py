import json
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline, FeatureUnion
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import pickle

class ItemSelector(BaseEstimator, TransformerMixin):
    def __init__(self, key):
        self.key = key
    def fit(self, x, y=None):
        return self
    def transform(self, data_dicts):
        return [item.get(self.key, '') for item in data_dicts]

class CustomFeaturesExtractor(BaseEstimator, TransformerMixin):
    def fit(self, x, y=None):
        return self
    def transform(self, data_dicts):
        features = []
        for item in data_dicts:
            subject = item.get('subject', '').lower()
            body = item.get('body', '').lower()
            text = subject + " " + body
            
            # Simple custom features: presence of $, numbers, ?
            has_dollar = 1.0 if '$' in text else 0.0
            has_rate_keywords = 1.0 if any(k in text for k in ['rate', 'c2c', 'w2', '1099', 'billing']) else 0.0
            has_question = 1.0 if '?' in text else 0.0
            
            features.append([has_dollar, has_rate_keywords, has_question])
        return np.array(features)

def load_data(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    # Ensure all items have 'subject' and 'body'
    for item in data:
        if 'subject' not in item:
            item['subject'] = ''
        if 'body' not in item:
            item['body'] = item.get('text', '')
    return data

def main():
    print("Loading training data...")
    # Using existing parity_test_data as placeholder, you should point this to your actual training json
    try:
        data = load_data('parity_test_data.json')
    except Exception:
        # Fallback to generating dummy data for the script to run if no data is found
        print("No training data found. Create training_data.json to use this script.")
        return
        
    X = [{'subject': item.get('subject', ''), 'body': item.get('body', '')} for item in data]
    y = [item['label'] for item in data]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    print("Building advanced pipeline...")
    pipeline = Pipeline([
        ('union', FeatureUnion([
            ('subject_tfidf', Pipeline([
                ('selector', ItemSelector(key='subject')),
                ('tfidf', TfidfVectorizer(ngram_range=(1, 3), max_features=1000))
            ])),
            ('body_tfidf', Pipeline([
                ('selector', ItemSelector(key='body')),
                ('tfidf', TfidfVectorizer(ngram_range=(1, 2), max_features=3000))
            ])),
            ('body_char_ngrams', Pipeline([
                ('selector', ItemSelector(key='body')),
                ('tfidf', TfidfVectorizer(analyzer='char_wb', ngram_range=(3, 5), max_features=2000))
            ])),
            ('custom_features', CustomFeaturesExtractor())
        ], transformer_weights={
            'subject_tfidf': 2.0,       # Subject is weighted heavier
            'body_tfidf': 1.0,
            'body_char_ngrams': 0.5,
            'custom_features': 1.0
        })),
        ('clf', LogisticRegression(class_weight='balanced', max_iter=1000))
    ])

    print("Training model...")
    pipeline.fit(X_train, y_train)

    print("Evaluating model...")
    y_pred = pipeline.predict(X_test)
    print(classification_report(y_test, y_pred))

    print("Saving pipeline to advanced_model.pkl...")
    with open('advanced_model.pkl', 'wb') as f:
        pickle.dump(pipeline, f)
        
    print("Training complete! Note: To use this in production, you must either wrap it in a Python microservice, or update the TypeScript inference engine in mlClassifier.ts to support FeatureUnion and char_wb ngrams.")

if __name__ == "__main__":
    main()
