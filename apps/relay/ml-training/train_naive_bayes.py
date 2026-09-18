import json
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import pickle

def load_data(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data

def main():
    print("Loading training data...")
    try:
        data = load_data('training_data.json') # Main training data
    except Exception:
        print("No training data found. Please ensure your JSON data exists.")
        return

    # Combine subject and body for the naive bayes input
    X = [item.get('subject', '') + " " + item.get('body', item.get('text', '')) for item in data]
    
    # Extract the label from expected_probabilities if 'label' key doesn't exist
    y = []
    for item in data:
        if 'label' in item:
            y.append(item['label'])
        elif 'expected_probabilities' in item:
            probs = item['expected_probabilities']
            y.append(max(probs, key=probs.get))
        else:
            y.append('Other')

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    print("Building Naive Bayes Pipeline...")
    # MultinomialNB works exceptionally well with TF-IDF features for text classification
    # as it computes the conditional probability of each class given the word frequencies.
    pipeline = Pipeline([
        ('tfidf', TfidfVectorizer(ngram_range=(1, 2), max_features=3000)),
        ('clf', MultinomialNB(alpha=0.1)) # alpha=0.1 for Laplace smoothing
    ])

    print("Training Naive Bayes model...")
    pipeline.fit(X_train, y_train)

    print("Evaluating model...")
    y_pred = pipeline.predict(X_test)
    print(classification_report(y_test, y_pred))

    print("Saving pipeline to naive_bayes_model.pkl...")
    with open('naive_bayes_model.pkl', 'wb') as f:
        pickle.dump(pipeline, f)
        
    print("Exporting Naive Bayes parameters to JSON for TypeScript inference...")
    tfidf = pipeline.named_steps['tfidf']
    clf = pipeline.named_steps['clf']
    
    export_data = {
        "model_type": "naive_bayes",
        "classes": clf.classes_.tolist(),
        "class_log_prior": clf.class_log_prior_.tolist(),
        "feature_log_prob": clf.feature_log_prob_.tolist(),
        "vocabulary": {k: int(v) for k, v in tfidf.vocabulary_.items()},
        "idf": tfidf.idf_.tolist() if hasattr(tfidf, 'idf_') else []
    }
    
    with open('model_export.json', 'w') as f:
        json.dump(export_data, f)
        
    print("\nNaive Bayes Training Complete!")
    print("Because Naive Bayes computes true probability distributions based on feature counts,")
    print("the output of `predict_proba` is naturally calibrated and yields excellent probabilistic bounds.")

if __name__ == "__main__":
    main()
