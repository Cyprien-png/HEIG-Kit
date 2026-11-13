# Network lab videos (RXI): the standard

A video of a network lab (RXI labs, or any lab where machines exchange data) always follows this style. The user asked
for it once and wants exactly the same for every next lab: "une vidéo du labo N de RXI", "même style que le labo 4",
"vidéo labo réseau". The complete model is `<root>/modules/hqvideo/examples/network-lab.tsx` (and its
`network-lab.narration.json`): the video of RXI lab 4, LAN, DHCP and Netcat. Read it before writing a new one and
reuse its pieces (`Net`, the cameras, `Card`, the scene layouts) rather than inventing new ones.

## What the video must do

1. **Cover the whole lab, objective by objective**, in the lab's order, with its names (devices, interfaces, pools,
   files, addresses). Read every page of the instructions first: `npm --prefix <root> run -s kb -- documents RXI`,
   then `kb -- document <id>` for the lab and its annexes (Cisco annex, command guides, book excerpts).
2. **Go fast on the manipulations, never on their purpose.** Clicking in EVE-NG, creating nodes, logging in: one line
   each. Every command or setting that is configured gets one sentence saying **what it is for** and what would go
   wrong without it (`no shutdown`: interfaces are off by default; `default-router`: the gateway announced to clients).
3. **The actors are always visible.** One persistent topology (`Device`, `Link`) drawn like the lab's figure, with each
   device's name and address under it, updated as the lab goes (fixed address, then "DHCP…", then the leased one).
4. **Every exchange is shown as traffic**: `Packet` envelopes travelling along the links (through the switch with
   `via`), `Broadcast` rings for broadcasts, `FileIcon` for transfers, the colors of `NET` (DHCP amber, ICMP teal, TCP
   violet, HTTP pink, ARP blue) used the same way in every video.
5. **Commands are typed in terminals** (`Terminal`, one per machine, titled "PC1 — console", with the real prompt:
   `labo@pc1:~$`, `Router>`, `Cheseaux(config-if)#`), outputs printed as the real tool prints them.
6. **Zoom-ins for the mechanisms.** Whenever the overview says something that hides a protocol ("le PC rejoint le
   réseau et obtient une adresse"), the camera zooms into that spot, a zoom scene explains it in detail, and the
   camera zooms back out to the overview, which goes on. Typical zooms: DHCP (DORA, why broadcast, ports 67/68), ping
   (echo request/reply, ARP), the modes of the Cisco CLI, a port, a TCP connection, DNS resolution, NAT translation,
   a routing table lookup, a firewall rule. Two to five zooms per video.
7. **The hands-on end of the lab is shown completely** (for lab 4, every Netcat use: chat, file, Web server, HTTP
   client), not summarized.
8. A recap scene ends the video, one card per objective, with the commands to remember.

Length: about one scene per objective plus one per zoom, 70 to 100 lines of narration (8 to 12 minutes with the
voice). The two usual questions still come first (normal or High quality, with or without audio): a network lab
video is always High quality.

## The zoom pattern

Each zoom is three moments, over two scenes:

- **The overview scene announces the zoom** in its last line ("Zoomons sur cet échange") and draws a `Lens` (a dashed
  frame with a magnifying glass) around the spot, then zooms into it:
  ```tsx
  const inAt = last.e - 30;                       // the zoom ends with the scene
  const scale = zoomScale(f, { outAt: back ? 0 : undefined, inAt, max: 2.8, dur: 30 });
  const opacity = 1 - ramp(f, inAt + 12, 18);
  <Camera focus={spot} scale={scale} opacity={opacity}> … </Camera>
  ```
- **The zoom scene** has a `ZoomBadge` breadcrumb top right (`["Vue d'ensemble", "PC1 rejoint le réseau", "DHCP"]`),
  a title starting with "Zoom · ", grows in at its start and shrinks away at its end:
  `scale = lerp(0.72, 1, ramp(f, 0, 22)) * lerp(1, 0.72, ramp(f, outAt, 24))` with `outAt = last.e - 26`.
  Its first line starts with "Zoom sur …", its last line says where we go back ("Retour à la vue d'ensemble").
  Inside: a `SeqDiagram` (arrow diagram, time going down) for message exchanges, the same messages travelling in a
  small copy of the network, and a `FieldCard` of the current message's main fields (addresses, ports, content).
- **The next overview scene zooms back out** from the same spot (`zoomScale(f, { outAt: 0, max: 2.8 })`, focus on the
  spot) and its first line says "Retour à la vue d'ensemble : …".

## Layouts that work (1920×1080, bottom 130 px for the subtitles)

- Overview with the router: router (960, 250), switch (960, 520), PCs (560, 780) and (1360, 780), terminals and cards
  in the free corners (top left under the header, left and right of the router).
- Two machines talking (Netcat, a client and a server): PC1 (480, 640), switch (960, 640), PC2 (1440, 640), one
  terminal per machine above them (x 90 and 1010, y 190, width 820), explanation cards under them (y 790).
- Overview next to a configuration: the topology scaled 0.6 in the top right (`<g transform="translate(874 56)
  scale(0.6)">`), the configuration terminals on the left, a `FieldCard` "ce que le client recevra" under the topology.
- A zoom: the arrow diagram on the left (x 210, width 640), the small network top right, the card bottom right.

## Narration

- Addresses, masks and ports in words ("dix point un point un point deux slash vingt-quatre", "le port sept sept sept
  sept"); commands said as one would read them aloud ("sudo ip address add …", "N C moins l moins p").
- Give `tts` for what the voice says badly: EVE-NG → "Ève N G", bootp → "boute pé", dhclient → "D H client",
  GET → "guette", DORA → "Dora", nc → "N C".
- Say what each thing is for, not what is on screen. One line per thing that appears.

## Checklist before rendering

- Every objective of the lab has its scene; every configured command has its purpose said; the hands-on part is shown
  in full; every zoom goes in from the overview and comes back out to it.
- `--check`, then a silent low quality preview (`--quality low --out <scratch folder>`) and a contact sheet of it
  (`ffmpeg -i preview.mp4 -vf "fps=1/5,scale=480:-1,tile=5x10" -frames:v 1 sheet.png`) read scene by scene:
  nothing overlapping, nothing under the subtitles, no empty seconds at the end of a zoom.
