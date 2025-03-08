export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { text } = req.body;
    if (!text) {
        return res.status(400).json({ error: 'Text is required' });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ASSISTANT_ID = process.env.ASSISTANT_ID;

    try {
        // Create a thread
        const threadResponse = await fetch('https://api.openai.com/v1/threads', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            }
        });

        if (!threadResponse.ok) {
            throw new Error(`Thread creation failed: ${await threadResponse.text()}`);
        }

        const thread = await threadResponse.json();

        // Add a message to the thread
        const messageResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({
                role: 'user',
                content: `Translate this word to Arabic. Format your response exactly like this example:
translated word: [Arabic translation]
type of the translation: [translation method - either التعريب اللفظي (transliteration) or الترجمة الحرفية (literal translation)]

Word to translate: ${text}`
            })
        });

        if (!messageResponse.ok) {
            throw new Error(`Message creation failed: ${await messageResponse.text()}`);
        }

        // Run the assistant
        const runResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({
                assistant_id: ASSISTANT_ID
            })
        });

        if (!runResponse.ok) {
            throw new Error(`Run creation failed: ${await runResponse.text()}`);
        }

        const run = await runResponse.json();

        // Poll for completion
        async function checkRunStatus() {
            const statusResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                    'OpenAI-Beta': 'assistants=v2'
                }
            });

            if (!statusResponse.ok) {
                throw new Error(`Status check failed: ${await statusResponse.text()}`);
            }

            const status = await statusResponse.json();

            if (status.status === 'completed') {
                const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
                    headers: {
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                        'Content-Type': 'application/json',
                        'OpenAI-Beta': 'assistants=v2'
                    }
                });

                if (!messagesResponse.ok) {
                    throw new Error(`Messages retrieval failed: ${await messagesResponse.text()}`);
                }

                const messages = await messagesResponse.json();
                const lastMessage = messages.data[0];
                
                return res.json({ translation: lastMessage.content[0].text.value });
            } else if (status.status === 'failed' || status.status === 'expired') {
                throw new Error(`Assistant run ${status.status}: ${status.last_error?.message || 'Unknown error'}`);
            } else {
                // Check again after 1 second
                await new Promise(resolve => setTimeout(resolve, 1000));
                return checkRunStatus();
            }
        }

        await checkRunStatus();

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
