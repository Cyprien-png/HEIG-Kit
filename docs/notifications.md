# Notifications

The web app of a [remote server](server.md) can ring your phone or your computer when something you were waiting for
is ready. It is off until you turn it on.

## Turning them on

Open **Réglages** (the gear, or your name at the bottom of the menu) and switch on **Activer les notifications sur
cet appareil**. The browser asks for its permission once. Do it on each device where you want them.

| Device | What it takes |
|---|---|
| Android (Chrome, Edge, Firefox, Samsung Internet) | Nothing more; installing the app on the home screen is optional |
| iPhone, iPad (iOS 16.4 or later) | **Install the app first**: in Safari, *Partager* → *Sur l'écran d'accueil*, then open HEIG-Kit from its icon and turn notifications on there. Apple gives no notifications to a site left in a Safari tab |
| Computer (Chrome, Edge, Firefox, Safari) | Nothing more |

**Envoyer une notification d'essai** rings the device at once, to check.

## What is announced

One switch each, kept by the server for your whole account (all your devices):

| Switch | When |
|---|---|
| Document ou vidéo prêt | A document (Markdown, PDF, Word, HTML) or a video you asked for finished rendering, or failed |
| Correction terminée | The correction of work you photographed is ready |
| Cours mis à jour | An administrator's ingestion, or the course repositories, brought new or changed course material |

A tap opens the page concerned: the file in the library, the correction, the courses.

## How it works

This is Web Push, the standard of the browsers (`src/webpush.ts`):

- The browser of each device makes a subscription with the push service of its maker (Apple, Google, Mozilla,
  Microsoft) and gives it to the server, which keeps it in `push_subscriptions`. The server only ever calls these
  push services, never an address a client hands it.
- Each message is encrypted for the device alone (RFC 8291): the push service carries it without being able to read
  it. It holds a title, a short text (the name of the document, the course and title of the correction) and a page.
- The server proves who it is with a key derived from `HEIG_JWT_SECRET` (VAPID, RFC 8292): nothing to configure.
  Changing that secret makes the devices subscribe again at their next visit. `HEIG_PUSH_CONTACT`
  (`mailto:you@example.org`) names who a push service may contact about the server; by default its public address.
- The server needs to reach the push services over HTTPS (outgoing, port 443).
- Logging out removes every device of the account; a device registered by another account rings for that one only;
  a subscription the browser dropped is forgotten at the next attempt.

An ingestion started with `npm run ingest` on the machine, outside the server, announces nothing.
