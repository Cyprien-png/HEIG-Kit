/**
 * The conditions of use of a shared server, read and accepted by each account at its first login, in the web
 * application and by the person themselves (there is no tool for an agent to accept them). Changing the text means
 * changing TERMS_VERSION: every account is then asked again.
 */
export const TERMS_VERSION = "2026-11-12";
export const REPOSITORY_URL = "https://github.com/Cyprien-png/HEIG-Kit";

export const TERMS_MARKDOWN = `
## 1. Le code qui tourne ici

Le code exécuté par ce serveur est strictement limité à celui publié sur le dépôt GitHub du projet :
[${REPOSITORY_URL.replace("https://", "")}](${REPOSITORY_URL}). Il ne s'agit pas nécessairement de la branche \`main\` :
le serveur peut tourner sur une autre branche du même dépôt (une version en cours de développement, par exemple), mais
jamais sur du code qui n'y est pas publié.

Tout le code est et restera open source (licence MIT). Chacun peut le lire, le vérifier, le copier et héberger son
propre serveur.

## 2. Vos mots de passe

- **Votre mot de passe HEIG-Kit n'est jamais enregistré.** Il est transformé par **Argon2id**
  ([RFC 9106](https://www.rfc-editor.org/rfc/rfc9106) ; 64 Mio de mémoire, 3 passes, 4 fils) en une clé maîtresse, dont
  deux clés indépendantes sont dérivées par **HKDF-SHA-256** ([RFC 5869](https://www.rfc-editor.org/rfc/rfc5869)). La
  première sert uniquement à vérifier votre mot de passe : c'est la seule qui est conservée dans la base. La seconde
  n'est jamais enregistrée.
- **Vos identifiants edu-ID sont chiffrés** avec cette seconde clé, en **AES-256-GCM**
  ([NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final)). Sans votre mot de passe HEIG-Kit, la base de
  données ne permet pas de les retrouver.
- La session edu-ID et le jeton Cyberlearn que le serveur garde pour lire vos horaires, vos notes et vos cours sont
  chiffrés sur son disque (AES-256-GCM) avec une clé propre au serveur, qui n'est pas rangée avec eux.
- Les connexions des applications et des agents suivent le standard **OAuth 2.1** avec PKCE
  ([RFC 7636](https://www.rfc-editor.org/rfc/rfc7636)) : aucun agent ne voit votre mot de passe.

## 3. Pourquoi même un administrateur n'accède pas à votre compte

- **Il ne connaît pas votre mot de passe**, et rien de ce qui est enregistré ne permet de le retrouver. Il peut vous
  en attribuer un nouveau, mais vos identifiants edu-ID chiffrés sont alors détruits, la session edu-ID effacée, et le
  compte reste bloqué tant qu'une connexion edu-ID n'a pas réussi, avec votre mot de passe edu-ID et votre code à deux
  facteurs.
- **Vos données personnelles sont cloisonnées par la base de données elle-même** : horaires, notes, absences,
  calendrier, corrections, profil d'apprentissage, progression dans les cartes et les quiz. Chaque requête s'exécute au
  nom du compte inscrit dans son jeton signé, et la base refuse de montrer les lignes d'un autre compte, quel que soit
  le rôle. Aucune fonction de l'application ne permet de consulter le compte de quelqu'un d'autre.
- **Ce qu'un administrateur peut faire** : créer, désactiver et supprimer des comptes, gérer et supprimer les
  contenus partagés (supports de cours, anciens TE, cartes, quiz, documents), et consulter le journal du serveur : qui
  a appelé quelle fonction et quand, jamais le contenu.

**La limite, dite honnêtement.** Ces protections valent pour le rôle d'administrateur dans l'application. La personne
qui héberge la machine a, elle, un accès technique au système. Vos mots de passe et vos identifiants n'y sont pas
lisibles. En revanche vos notes, absences, horaires, corrections, profil d'apprentissage et progression y sont
enregistrés sans chiffrement : c'est nécessaire pour que le serveur puisse les synchroniser et les afficher.

**Ces données ne sont partagées avec personne** : ni avec les autres comptes, ni avec les administrateurs, ni avec un
tiers. L'hébergeur peut y accéder par simple contrainte technique, parce qu'il a la main sur la machine, et non parce
que l'application les lui montre. De même, un serveur dont le code aurait été modifié pourrait observer ce qui y
transite, y compris vos identifiants au moment où vous les saisissez. C'est la raison de l'engagement du point 1, et
c'est une confiance que vous accordez à cette personne en utilisant ce serveur.

## 4. Contenus partagés et injection de prompt

**Ceci est un serveur de partage.** Les supports de cours, cartes, quiz, documents et vidéos sont communs à tous les
comptes. En l'utilisant, vous comprenez et acceptez que **tous les documents et moyens de révision que vous générez**
(fiches, corrigés, TE blancs, paquets de cartes, quiz, vidéos), vous-même ou par l'intermédiaire de votre IA, **sont
partagés avec tous les autres comptes**, sous votre nom. N'y mettez rien que vous ne voulez pas montrer : une fiche
bâtie sur vos points faibles ou sur vos notes devient visible par tous. Seul un administrateur peut ensuite supprimer
un contenu partagé.

Chacun peut créer ces contenus avec sa propre IA. **Ils ont pour vocation d'être utilisés via l'interface web.**

Vous êtes libre de demander à vos agents de récupérer la matière de cours et les contenus du serveur. Si vous le
faites, vous le faites en pleine conscience que quelqu'un a pu glisser, dans un contenu généré par un utilisateur, des
instructions destinées à votre IA (« injection de prompt ») : par exemple pour lui faire recopier vos notes ou votre
profil dans un contenu partagé, ou pour lui faire exécuter une action que vous n'avez pas demandée. Rien ne permet de
l'empêcher avec certitude. Relisez ce que vos agents font en votre nom.

## 5. Responsabilité

Cet outil n'a pour vocation que de simplifier la vie. Personne n'est forcé de l'utiliser : il est de la responsabilité
de chaque utilisateur de décider s'il l'utilise, et comment.

Le service est fourni tel quel, sans aucune garantie : ni de disponibilité, ni d'exactitude des horaires, des notes,
des échéances, des corrections ou des contenus générés, qui ne remplacent ni GAPS, ni Cyberlearn, ni vos enseignants.
En cas de vol d'informations, de perte de données ou d'échec scolaire, le ou les développeurs et mainteneurs ne sont
aucunement responsables.
`.trim();
