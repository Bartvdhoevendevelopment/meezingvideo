# Meezingvideo

Een eenvoudig, premium-uitziend platform voor het meezingen met aanbiddingsliederen op YouTube — met getimede ondertiteling, zodat ook slechthorenden en doven kunnen meezingen. Geïnspireerd op de "Lyrics"-functie van Spotify.

## Wat zit erin

- **index.html** — homepagina met zoekfunctie, YouTube-speler en mee-scrollende songtekst.
- **admin.html** — beheerpagina met login om liederen en teksten toe te voegen, te bewerken en te verwijderen.
- **style.css** — donker premium thema in Claude-stijl (warme accentkleur, vloeiende animaties).
- **app.js / admin.js** — JavaScript voor de twee pagina's.
- **supabase-config.js** — verbinding met de Supabase database.

## Snel starten

### 1) Open de homepagina

Dubbelklik `index.html` of host de map ergens (Netlify drop, Vercel, GitHub Pages…). De homepage werkt direct — er staat al een demolied klaar: **"Al wat ik ben (Opwekking 697)"**.

> Type bv. "al wat" in de zoekbalk en kies het lied.

### 2) Admin account aanmaken

Voordat je iets kunt bewerken moet je één keer een beheeraccount aanmaken. Ga naar:

[Supabase dashboard → Authentication → Users → Add user](https://supabase.com/dashboard/project/pgadgqtpbreyfmufsung/auth/users)

- Klik **"Add user"** → **"Create new user"**
- Vul je e-mailadres en wachtwoord in
- Vink **"Auto Confirm User"** aan
- Klaar

Open daarna `admin.html` en log in met die gegevens.

### 3) Liederen toevoegen

In de beheermodule:

1. Klik op **"+ Nieuw"** links bovenin.
2. Vul titel, artiest en de YouTube-link in (gewoon de complete YouTube-URL plakken — het video-ID wordt automatisch herkend).
3. Klik **"Opslaan"**.
4. Er verschijnt een voorbeeldspeler. Speel de video af en klik op **"Pak huidige tijd voor nieuwe regel"** om regels te timen, of gebruik **bulk-import** om een hele tekst tegelijk te plakken in dit formaat:

```
0.0 Al wat ik ben,
2.5 leg ik in uw hand.
5.0 Bind mij aan U
```

5. Klik **"Songtekst opslaan"**. De wijzigingen zijn meteen zichtbaar op de homepagina.

## Hoe het werkt (technisch, kort)

- **Frontend**: pure HTML/CSS/JS — geen build-stap, geen frameworks. Werkt door simpelweg de bestanden te openen of te hosten.
- **Database**: Supabase Postgres. Twee tabellen, `meezingvideo_songs` en `meezingvideo_lyrics`, met Row Level Security: iedereen mag lezen (publieke website), alleen ingelogde gebruikers mogen schrijven (admin).
- **Video sync**: YouTube IFrame Player API. Elke 200 ms wordt `getCurrentTime()` gelezen en wordt de juiste tekstregel gemarkeerd en in beeld gescrolld.
- **Auth**: Supabase Auth (email + wachtwoord).

## Tips

- **Klik op een tekstregel** in de speler om naar dat moment in de video te springen.
- **Auto-scroll uit**? Klik rechtsboven op het "Auto-scroll" knopje als je liever zelf scrollt.
- **Deeplink**: `index.html?id=<song-id>` opent direct het juiste lied.

## Beveiliging

De `supabaseAnonKey` in `supabase-config.js` is een publieke key — die mag in de browser staan. Schrijven naar de database kan alleen na inloggen (RLS in Supabase). Houd je beheerwachtwoord goed geheim.

## Hosten

Snelste opties:
- [Netlify Drop](https://app.netlify.com/drop) — sleep de hele map erin, klaar.
- [Vercel](https://vercel.com) — `vercel deploy` vanuit deze map.
- GitHub Pages, Cloudflare Pages, etc. — werkt allemaal omdat het pure statische bestanden zijn.

---

Gemaakt met Claude.
