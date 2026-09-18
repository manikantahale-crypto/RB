const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '../../.env' }); // Load database URL

async function exportInboxToTrainingData() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("Error: DATABASE_URL not found in .env");
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  console.log("📥 Extracting real emails from your live inbox database...");

  try {
    // We only want emails that have been classified and are received
    const query = `
      SELECT m.subject, m.raw_body, c.reply_intent, c.confidence_source
      FROM public.email_messages m
      JOIN public.email_classifications c ON m.id = c.message_id
      WHERE m.direction = 'received' 
      AND c.reply_intent IS NOT NULL
      ORDER BY m.date DESC
    `;
    
    const res = await client.query(query);
    console.log(`Found ${res.rows.length} real emails in the database.`);

    const trainingData = res.rows.map(row => {
      // Clean up body for training (remove excessive whitespace)
      const cleanBody = (row.raw_body || '').replace(/\\s+/g, ' ').trim();
      
      return {
        subject: row.subject || '',
        body: cleanBody,
        label: row.reply_intent,
        source: row.confidence_source // 'llm' or 'rule' or 'ml'
      };
    });

    const outPath = path.join(__dirname, 'real_inbox_training_data.json');
    fs.writeFileSync(outPath, JSON.stringify(trainingData, null, 2));
    
    console.log(`\n✅ Successfully exported to: ${outPath}`);
    console.log("-------------------------------------------------");
    console.log("HOW TO USE THIS DATA TO BOOST ACCURACY TO 95%+:");
    console.log("1. Open real_inbox_training_data.json");
    console.log("2. Manually verify the 'label' assigned to each email is correct.");
    console.log("3. Add any custom manual samples you want to the bottom of the JSON file.");
    console.log("4. Copy the contents and merge them into 'parity_test_data.json'.");
    console.log("5. Run: python train_naive_bayes.py");
    console.log("-------------------------------------------------");
    
  } catch (err) {
    console.error("Error querying database:", err);
  } finally {
    await client.end();
  }
}

exportInboxToTrainingData();
