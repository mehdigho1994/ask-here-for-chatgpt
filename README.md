# Ask Here for ChatGPT

A Chrome extension for chatgpt.com.

Select text, click **Ask here**, and get the answer in a sticky note on the same page — without leaving where you were reading.

> Unofficial. Not affiliated with OpenAI or ChatGPT.

---

## What it does

1. Select any text on ChatGPT  
2. Click **Ask here**  
3. Optionally type your own question (e.g. `why` or `translate`)  
4. Read the reply in a sticky note on the same page  

Behind the scenes, a temporary helper ChatGPT tab is opened (pinned / inactive), the question is sent, the reply is brought back to the note, and the helper tab is closed. You stay on your current chat.

---

## Install (Developer mode)

1. Clone or download this repo  
2. Open `chrome://extensions`  
3. Turn on **Developer mode**  
4. Click **Load unpacked** and select this project folder  
5. Open `chatgpt.com`, refresh once, select text, and try it  

After updating the extension, click **Reload** on the Extensions page, then refresh ChatGPT too.

---

## Usage

- Works only on `chatgpt.com` and `chat.openai.com`  
- You must be signed in to ChatGPT  
- If you type a question, it is sent together with the selected text  
- Drag, copy, minimize, or close the sticky note  
- Click the extension icon for support email and privacy info  

---

## Privacy

This extension does not send your data to the developer’s servers.  
Selected text is processed on your device and submitted only inside **your own ChatGPT session**.  
No analytics, ads, or tracking.

Full policy:  
[Privacy Policy](https://sites.google.com/view/askhereforchatgpt/home)

---

## Project structure

```
manifest.json   → extension config (MV3)
content.js      → page UI + worker logic
background.js   → request queue, helper tab, reply delivery
config.js       → ChatGPT DOM selectors
popup.html      → toolbar popup
privacy.html    → privacy policy text
icons…          → extension icons
```

---

## Support / contact

Questions, bugs, ideas:  
**mehdigho1994@gmail.com**

---

## License

Free for personal use and publishing with attribution.  
ChatGPT and OpenAI are trademarks of their respective owners. This project is unofficial.
