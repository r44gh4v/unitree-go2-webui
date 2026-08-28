# unitree_go2_webui

A web interface for the Unitree Go2. Video, audio, driving, the full sport command
set, telemetry, the lidar map, and a raw protocol console - in a browser, over
WebRTC, talking to the robot directly.

Everything runs locally. Nothing is installed system-wide and no data leaves your
machine except the SDP handshake with the robot (and, if you choose the account
sign-in method, the login request to Unitree).

## Running it

```
npm install
npm run build
npm start
```

Then open http://localhost:8080.

For development with hot reload:

```
npm run dev
```

That serves both the interface and the API on http://localhost:8080 with Vite in
middleware mode, so source edits hot-reload in the open page - no rebuild, no
manual refresh.

The console is open to anyone who can reach that port, which is fine on your own
machine. To lock it - worth doing on a shared network - start it with a password:

```
WEBUI_PASSWORD=something npm start
```

It then asks for that password once per browser and remembers the answer for
three months. The server says which mode it started in.

## Connecting

Four ways to reach the robot, picked at the top of the left panel:

**Address** (the *IP* tab) - the robot is on your Wi-Fi and you know its IP. Press *Scan* to
sweep the network if you don't.

**Serial number** (*Serial*) - the robot is on your Wi-Fi. Its address is found for you by
multicast. The serial is printed under the robot and shown in the phone app.

**Robot hotspot** (*AP*) - join the Wi-Fi network named after the robot's serial number,
then connect. The robot is always at 192.168.12.1 in this mode. Your laptop has
no internet while joined to it.

**Unitree account** (*Cloud*) - sign in with the same email and password you use in the
phone app. Your robots are listed by name and reachable from anywhere, relayed
through Unitree's servers. This also fetches each robot's device key
automatically and, being cloud-relayed, works across networks (a TURN server is
fetched and both sides meet there).

### The device key

Firmware 1.1.15 and newer encrypt the local handshake with a key tied to the
robot's serial number. If a local connection fails with a message about the AES
key, either sign in with your Unitree account once (which fills the key in), or
paste it under *Device key*. Older firmware ignores the field.

### If the connection is refused

The robot allows one WebRTC client at a time. Close the phone app and try again.

## Control from anywhere

The console can run in the cloud so you can drive the robot from any browser,
anywhere, without hosting anything yourself - no machine left running at home,
no port forwarding, no tunnel. The robot just needs to be on a Wi-Fi network
with internet.

Deploy your own free copy to Vercel in one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fr44gh4v%2Funitree-go2-webui&env=WEBUI_PASSWORD&envDescription=Password%20that%20locks%20your%20console)

Or from the command line (the repo already carries the config):

```
npx vercel                                        # create the project
npx vercel env add WEBUI_PASSWORD production      # set the console password
npx vercel --prod                                 # production URL
```

The password is what keeps the public URL from being an open remote control:
the console shows a lock screen until it is entered, and every API call is
refused without it. A cloud deployment with no password does not fall open -
the API refuses to serve and the page says what to configure.

A deployed console is the same interface with the same features; what changes is
which connection method can reach the robot. A cloud deployment has no network
of its own, so **Cloud** is the only method offered there - the other four are
greyed out with the reason, rather than failing later with a message about
routers. Sign in, pick the robot, and the link is relayed through Unitree's TURN
servers exactly as the phone app does it. Run the console at home for IP,
Serial, AP and LAN.

Latency grows with distance - expect the video to lag more than on your own
Wi-Fi, and drive accordingly. The Esc stop works the same either way.

## Layout

Three columns: controls on the left, the camera and live numbers in the middle,
everything else in tabs on the right. Drag the dividers between them to resize,
including the one under the camera, and double-click a divider to reset it. Your
sizes are remembered.

There is no title bar - the vertical space goes to the panels instead. STOP is
pinned above the drive controls where it never scrolls away. Connection state
lives in one place, the panel at the top of the left column; the strip along the
bottom carries the keyboard hints and, once connected, battery and link rate.

The connection panel folds itself away once the link is up.

## Using it

The **Esc** key stops the robot from anywhere in the interface, including while
typing in a text field. It sends *StopMove* followed by *Damp*, which halts
locomotion and lets the joints go compliant. The STOP button pinned above the
drive controls does the same thing.

Drive with **W A S D** and turn with **Q** and **E**, or drag the two sticks, or
plug in a gamepad. Movement only happens while an input is held; releasing sends
a stop.

Before the robot will walk, it usually needs *Stand up* followed by *Ready
stance*. If it has fallen over, use *Recover*.

Flips, jumps and handstands are marked with a **!** on the Actions tab. They
need two metres of clear, soft, level floor, and they can damage the robot or
injure someone standing nearby.

When the robot reports a fault - an overheating motor, a failed service - it
appears as a message in the corner whichever tab you are on, so it is not missed
while you are watching the camera. The full list stays on the Status panel.

### Motion modes

The robot exposes different commands depending on which motion service it runs.
*Normal* covers walking and gestures. *AI* unlocks flips, the handstand and the
free gaits. *MCF* is the single unified service firmware 1.1.7 and newer run;
there is no api that turns it on or off, so the console reports what the robot
says and lets you pick which id table to send. The Actions tab lists every
action whatever the service - the ones the running service does not carry are
hatched and say so, rather than disappearing. Use *Re-check* to ask the robot
again.

### Camera

The camera is one panel among several rather than the whole window; drag the
divider under it if you want more or less of it.

*Photo* asks the camera for a full-resolution 720p still, which arrives as a
JPEG split across several data-channel frames and is reassembled before it
saves. The frame button beside it grabs the current video frame instead, which
is faster but lower quality.

### Media

The Media tab holds the head light, the speaker, and the robot's audio library.
Upload any audio file and it is converted to the 44.1 kHz mono WAV the robot
insists on, then sent over the data channel. You can also record straight from
your microphone - up to a minute - and either store the clip in the library or
push it out through megaphone mode, which plays audio without saving it. The
built-in announcements the robot ships with are there too.

### Lidar

The Lidar tab streams the head lidar's occupancy grid and draws it as a
height-coloured surface: each solid voxel contributes only the faces that face
empty space, so it reads as a real surface rather than a haze of dots, the same
way the robot's own viewer does it. It is off by default because it uses real
bandwidth. Starting it also turns off the robot's traffic-saving mode, which
throttles high-rate topics, and sends the switch-on a few times because the
firmware routinely drops the first one.

### Map

The Map tab drives the robot's SLAM module: build a map of a space, work out
where the robot is on it, walk to a point, or set a patrol route. This module
talks in plain text commands rather than the API ids everything else uses, and
its replies come back as log lines - turn the log on before sending anything.

Patrol points only stick if you add them in the window right after *Start*; the
module rejects them once it has gone idle. The robot has a single map slot, so
mapping again replaces what was there.

*Download map* pulls the built map off the robot and saves it to your computer -
the point cloud (`map.pcd`) plus the occupancy grid and metadata (`map.pgm`,
`map.txt`) when they exist. The files move over a chunked file-transfer channel,
one after another, so a large map takes a moment.

### System

Service list with start and stop switches, the settings the robot reports about
itself, and the built-in information scripts (firmware version, IP addresses,
serial number). The script runner is a fixed menu the robot ships, not a shell.

### Console

The Console tab has a searchable catalogue of every documented command - pick
one and it fills in the topic, API id, and an example parameter. It also sends
arbitrary requests, watches any topic live, and logs every message on the wire.
Anything the protocol supports but this interface has no button for can be
driven from there.

## How it fits together

The browser holds the WebRTC peer connection directly with the robot - video,
audio, and the data channel all flow point to point. The Node server exists only
because the browser cannot perform the signaling handshake itself: neither the
robot nor Unitree's cloud serves CORS headers, and newer firmware wraps the
exchange in AES and RSA. So the server relays exactly one thing, the SDP offer
and answer, and then steps out of the way.

On this network:

```
browser  ──POST /api/connect──▶  node server  ──HTTP──▶  robot :9991 or :8081
   │                                                          │
   └──────────── WebRTC: video, audio, data channel ──────────┘
```

From anywhere, with the account method - same shape, one more hop, and the
media meets in the middle at Unitree's relay:

```
browser  ──POST /api/connect──▶  server  ──▶  Unitree cloud  ──▶  robot
   │                                                               │
   └────────── WebRTC through Unitree's TURN relay ────────────────┘
```

Everything else happens in the browser: decoding video, unpacking the lidar
grid, building the voxel mesh, and every control message. The server handles no
robot traffic at all, which is why a free deployment is enough to run it.

| Path | What lives there |
| --- | --- |
| `src/lib/go2.ts` | Data channel protocol: validation, heartbeat, pub/sub, requests |
| `src/lib/constants.ts` | Topics, API ids, error tables |
| `src/lib/voxel.ts` | LZ4 and voxel decoding for the lidar, in pure TypeScript |
| `src/state/RobotContext.tsx` | Shared connection and telemetry state |
| `src/lib/serverInfo.ts` | Asks the server whether a password gate is in the way |
| `server/index.mjs` | Local entry: the API plus static files, or Vite with `--dev` |
| `server/app.mjs` | The API routes, shared by the local server and the cloud function |
| `server/auth.mjs` | The optional password gate (stateless signed-cookie sessions) |
| `server/signaling.mjs` | The two LAN handshake flows |
| `server/crypto.mjs` | AES, RSA, and the path derivation the handshake needs |
| `server/cloud.mjs` | Unitree account login and cloud-relayed signaling |
| `server/discovery.mjs` | Multicast and port-sweep discovery |
| `api/index.mjs` | Vercel serverless entry wrapping `server/app.mjs` |
| `test/` | Crypto, voxel, and signaling tests, plus a browser protocol loopback |

## Tests

```
npm test           # crypto, LZ4/voxel decoding, and both signaling flows
npm run test:protocol   # opens the browser loopback test
```

`npm test` runs the signaling handshake against a mock robot that implements
both firmware flows and all three key-exchange variants, so the hardest part of
connecting is covered without hardware. The protocol test wires two peer
connections together in the browser, runs the real client against a stand-in
robot, and checks the validation handshake, heartbeat, request matching,
subscriptions, binary framing, chunk reassembly, and teardown.

## Protocol notes

Transcribed from [legion1581/unitree_webrtc_connect](https://github.com/legion1581/unitree_webrtc_connect)
(the signaling handshake, data-channel framing, and the API id tables),
[legion1581/unitree_ui](https://github.com/legion1581/unitree_ui) (the SLAM
command vocabulary, the bashrunner request shape, the `robot_state` service
APIs, and the double-encoded state topics), and
[tfoldi/go2-webrtc](https://github.com/tfoldi/go2-webrtc) (the original
reverse-engineered JavaScript client).

- Requests are `{"type":"req","topic":T,"data":{"header":{"identity":{"id":N,"api_id":A}},"parameter":S}}`
  where `parameter` is always a **string**, JSON-encoded if it holds an object.
- Replies are matched on `data.header.identity.id`, not on topic.
- The robot opens with a validation challenge; the answer is
  `base64(md5_bytes("UnitreeGo2_" + key))`.
- A heartbeat is due every two seconds or the robot drops the link.
- Binary frames carry a JSON header and a payload. Lidar frames are marked by a
  `(2, 0)` uint16 pair and use a 32-bit length; everything else uses 16-bit.

## Safety

This drives a 15 kg machine that can move faster than you can step back. Give it
room, keep the Esc key in reach, and do not run the **!** moves indoors near
furniture or people.

## Credits

Konstantin Severov's [unitree_webrtc_connect](https://github.com/legion1581/unitree_webrtc_connect)
and [unitree_ui](https://github.com/legion1581/unitree_ui) (both MIT) did the
hard reverse-engineering this project stands on. Between them they document the
encrypted signaling handshake, the data-channel wire format, the API id tables,
and several surfaces that exist nowhere else in public - notably that the SLAM
module takes plain `module/action/arg` strings rather than API ids, which is
what the Map tab is built on.

The action symbols on the Actions tab are bundled from `unitree_ui`'s
`public/icons/`, and mirror the symbols in the official Unitree Go app. The files
live in `src/assets/actions/` with a note in `ATTRIBUTION.md`; their `fill` was
changed to `currentColor` so they take the interface colour. The remaining
interface icons (camera, mic, and so on) are original inline SVGs in
`src/components/Icons.tsx`.

[tfoldi/go2-webrtc](https://github.com/tfoldi/go2-webrtc) is the original
reverse-engineered client and the starting point for all of the above.
[abizovnuralem/go2_ros2_sdk](https://github.com/abizovnuralem/go2_ros2_sdk)
supplied the lidar and telemetry message shapes.

This project shares no application code with any of them: the protocol is
reimplemented in TypeScript here (including a pure-TS LZ4 and voxel decoder in
place of their WASM one), and the interface is its own design.

## License

MIT - see [LICENSE](LICENSE). The bundled action icons are MIT as well, from
`unitree_ui`; their provenance is noted in
[src/assets/actions/ATTRIBUTION.md](src/assets/actions/ATTRIBUTION.md).
