async function testModel(modelName) {
  const key = "xai-zDNe74Ld5IxWgUrAlx2d6VfCUp4D8L1h5Zf1874D6mIrh8OWMGSE3pbbGXdqurNrtffKnzLf0aYVvQ5s";
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.8,
        messages: [
          { role: "user", content: "Say hello!" }
        ],
      }),
    });
    console.log(`Model ${modelName} status: ${res.status}`);
    const text = await res.text();
    console.log(`Response: ${text.slice(0, 500)}`);
  } catch (e) {
    console.error(`Model ${modelName} failed:`, e);
  }
}

async function run() {
  await testModel("grok-4.6");
  await testModel("grok-2");
  await testModel("grok-beta");
  await testModel("grok-2-1212");
}

run();
