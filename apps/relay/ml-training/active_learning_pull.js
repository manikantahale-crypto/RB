const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '../../.env' }); // or wherever your .env is

async function pullEscalatedEmails() {
  // Ensure DATABASE_URL is set, you might need to adjust the path to your .env
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not found. Run this from apps/relay or set the env var.");
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  console.log("Fetching LLM-escalated emails for active learning...");

  try {
    const query = `
      SELECT m.id, m.subject, m.raw_body, c.reply_intent
      FROM public.email_messages m
      JOIN public.email_classifications c ON m.id = c.message_id
      WHERE c.confidence_source = 'llm'
      ORDER BY m.date DESC
    `;
    
    const res = await client.query(query);
    console.log(`Found ${res.rows.length} escalated emails.`);

    const trainingData = res.rows.map(row => ({
      messageId: row.id,
      subject: row.subject,
      body: row.raw_body,
      label: row.reply_intent,
      status: "NEEDS_REVIEW"
    }));

    const outPath = path.join(__dirname, 'active_learning_review.json');
    fs.writeFileSync(outPath, JSON.stringify(trainingData, null, 2));
    
    console.log(`\nSuccessfully exported to ${outPath}`);
    console.log("Next Steps:");
    console.log("1. Open active_learning_review.json");
    console.log("2. Review the 'label' assigned by the LLM and correct it if necessary.");
    console.log("3. Change 'status' to 'REVIEWED'.");
    console.log("4. Append the reviewed entries into your main training_data.json.");
    
  } catch (err) {
    console.error("Error querying database:", err);
  } finally {
    await client.end();
  }
}

pullEscalatedEmails();
