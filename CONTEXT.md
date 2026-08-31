# Go2 Console

A web console for driving a Unitree Go2 robot dog. One operator, one robot, one
live link. The vocabulary below is what the code and the interface both use;
where the robot's own firmware disagrees, the firmware's name is noted so it can
be recognised on the wire.

## Language

### The robot and what it is doing

**Robot**:
The Go2 itself. Always the physical machine, never the console's picture of it.
_Avoid_: dog, device, unit

**Mode**:
A posture or gait the robot holds until told otherwise — a handstand, a walking
style, pose. Outlives the console, which is why it has to be cleared on the way
out.
_Avoid_: state, pose (pose is one mode, not the category)

**Action**:
One thing the robot can be asked to do, named in `constants.ts` with the api id
each motion service uses for it. Some are momentary, some settle into a mode.
_Avoid_: command, move

**Motion service**:
Which id table the robot is answering on — normal, ai, advanced or mcf. The same
action has different ids across them, so the service has to be known before an
action can be sent.
_Avoid_: firmware mode, motion mode

**Telemetry**:
What the robot publishes without being asked: battery, joint temperatures,
posture, velocity. Read-only and continuous.
_Avoid_: status, stats, readings

### Sensing

**Lidar**:
The spinning head sensor. On or off refers to the physical rotation, not to
whether the map view is open.
_Avoid_: radar, scanner

**Obstacle avoidance**:
The assist that reads the lidar and refuses drive commands that would hit
something. Consumes the lidar, so it cannot run without it.
_Avoid_: radar (the reference project uses this and it is misleading), collision
detection

**Map**:
The SLAM output — a point cloud and its metadata, transferred as whole files.
Distinct from the live voxel view, which is not stored.
_Avoid_: scan, point cloud (that is one file within a map)

### The link

**Link**:
The live WebRTC connection to the robot: the data channel and the media that
came with it. Either up or not.
_Avoid_: connection, session, socket

**Signalling**:
The one-shot exchange that gets a link started — an offer out, an answer back,
through the local proxy or the Unitree cloud. Cannot be repeated on a live link,
which is why recovery opens a fresh one.
_Avoid_: handshake (that is the validation step that follows), negotiation

**Connection method**:
How the console reaches the robot: IP, Serial, AP, LAN or Cloud. Cloud means the
signalling goes through Unitree's servers; the media may still go direct.
_Avoid_: transport, mode

**Recovery**:
Reopening a link that was working and dropped. Distinct from connecting, which
is the operator's decision, and from retrying, which is the operator asking
again after a failure.
_Avoid_: reconnect (the verb is fine, the noun is ambiguous with retry)

**Operator**:
The person at the console. Named because most decisions turn on whether the
operator asked for something or the console decided it — hanging up is not a
fault to recover from.
_Avoid_: user, client
