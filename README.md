# Breath Training

Static web app for timed breathing exercises.

Open `index.html` in a browser.

For offline install on a phone, publish the folder through a normal web server or Netlify, open it once online, then use the browser menu to add it to the home screen.

Default pattern:

- Inhale: 0 sec
- Hold after inhale: 0 sec
- Exhale: 0 sec
- Hold after exhale: 0 sec
- Exercise time: 15 min
- Cycles: 15
- Wait before start: 15 sec
- Pre-start short beep: 3 sec before start

Long beep marks the start and end of the exercise. Short beeps mark the pre-start signal and phase changes.

Six presets are stored locally in the browser with `localStorage`.
