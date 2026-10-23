# Gap finder

Gap finder is a one-page tool for one or two teachers to try. Pick a skill a student is stuck on, see the Marble prerequisite path underneath it, and mark what is secure, shaky, or not yet. It then suggests what to teach next and what to check first.

There is no AI. Marks stay in the browser. Feedback email is the only thing the server sends, and that message never includes a student record.

The look matches the Better Schools Comment Drafter: the same logo files, navy `#042e5e`, Classic and Dark appearances, Georgia titles, and amber focus. Body text uses self-hosted Lexend so it stays readable and nothing is loaded from a third party.

## Project files

```text
Gap-Finder/
├── .cpanel.yml                   ← cPanel "Deploy HEAD Commit" tasks
├── deploy/
│   └── cpanel-deploy.sh          # Copies site files; keeps config.php and Directory Privacy
├── public/                       ← Deployed to $HOME/betterschools.com.au/gap-finder
│   ├── index.html                # Built page, with the skill catalog embedded
│   ├── app.js                    # Search, paths, marks, backup, feedback
│   ├── app.css                   # Classic layout
│   ├── dark.css                  # Dark palette
│   ├── skin.js                   # Classic / Dark switch
│   ├── theme-init.js             # Applies the appearance before first paint
│   ├── feedback.php              # Feedback endpoint
│   ├── private_path.php          # Finds the private config outside the document root
│   ├── data/                     # One JSON file per subject, built by source/build.py
│   ├── assets/                   # Better Schools logos
│   └── fonts/                    # Lexend (SIL Open Font License)
├── private/                      ← Deployed to $HOME/gap-finder-private
│   ├── bootstrap.php
│   ├── feedback_lib.php
│   └── config.example.php        # FEEDBACK_TO defaults to info@betterschools.com.au
├── source/
│   ├── build.py                  # Rebuilds public/index.html and public/data/
│   ├── template.html
│   └── data/                     # Marble Skill Taxonomy v1, unchanged
└── tests/
```

## Data

Mathematics and English are marked as the recommended place to start because their prerequisite data is the strongest. Science, History, Geography, Computing, Personal & Social Development, Life Skills, and Learning to Learn are all available. Mathematics and English load with the page. Other subjects load when a skill needs them.

Rebuild after a taxonomy change:

```bash
python3 source/build.py
```

Run that from the repository root. It writes `public/index.html` and `public/data/*.json`. Commit that built output with the source.

## Students

A teacher adds a first name or initials. The page asks them not to enter a surname, class, or school. Marks are stored in `localStorage` on that browser. Export downloads a JSON backup. Import reads a backup back into the same browser. The backup includes the Marble credit. Nothing about a student is posted to the server.

## Feedback

Each prerequisite has a **This link looks wrong** button. A general box sits at the bottom of the page. Both POST JSON to `feedback.php`. The message can include the skill ids and names, the link, the comment, and an optional teacher name and email. The endpoint checks the same origin, a CSRF token, a honeypot field, and a rate limit. It does not store the message. Mail is sent from `noreply@betterschools.com.au`.

The recipient is `FEEDBACK_TO` in the private config. The example, and the default to copy onto the server, is the public address `info@betterschools.com.au`.

## Marble credit

Visible on every screen, included in every backup, and included in each subject file:

Marble Skill Taxonomy (v1) · © Generative Spark, Inc. (Marble) · https://withmarble.com · ODbL 1.0 (database) and CC BY-SA 4.0 (content) · https://github.com/withmarbleapp/os-taxonomy

This is a starting point, not a diagnosis. Ages are approximate and the taxonomy is not written for learners with additional needs. Curriculum standards referenced by the taxonomy have their own upstream licences (see PROVENANCE.md in that repository).

## Local preview

```bash
python3 source/build.py
php -S 127.0.0.1:8765 -t public
```

Open http://127.0.0.1:8765 . To try feedback locally, copy `private/config.example.php` to `private/config.php`. Git ignores `config.php`. The example already sets `FEEDBACK_TO` to `info@betterschools.com.au`.

## Checks

```bash
python3 source/build.py
python3 tests/path_check.py
php tests/feedback_check.php
bash tests/feedback_http.sh
bash tests/deploy_check.sh
```

## Deploy on cPanel

cPanel clones this repository **outside** the website. **Deploy HEAD Commit** runs `.cpanel.yml`, which runs `deploy/cpanel-deploy.sh`. The script uses `$HOME`, so the account name is not stored in Git. The document root for betterschools.com.au is `$HOME/betterschools.com.au`, not `$HOME/public_html`.

The script copies `public/` to `$HOME/betterschools.com.au/gap-finder` and `private/` to `$HOME/gap-finder-private`. `config.php` is never created, copied, or deleted. A Directory Privacy block marked `cp:ppd` in the live `.htaccess` is kept. The live address is `https://betterschools.com.au/gap-finder`.

Do not clone into `betterschools.com.au` or `public_html`. Do not point the domain’s document root at the clone or at `gap-finder-private`.

### One-time setup

Use the cPanel account that serves betterschools.com.au.

**1. Clone outside the website**

1. Open **cPanel → Files → Git Version Control → Create**.
2. Leave **Clone a Repository** on.
3. Clone URL: `https://github.com/goodfunnysmart/Gap-Finder.git` (or the SSH URL if a deploy key is already in use).
4. Repository Path: `repositories/Gap-Finder`. cPanel creates `$HOME/repositories/Gap-Finder`. Do not use a path inside `betterschools.com.au` or `public_html`.
5. Repository Name: `Gap Finder`.
6. Click **Create**.

**2. First deploy**

1. **Git Version Control → Manage** for Gap Finder.
2. Set **Checked-Out Branch** to `main` and click **Update** if another branch is selected.
3. Open **Pull or Deploy**.
4. Click **Update from Remote**, then **Deploy HEAD Commit**.

That creates:

```text
$HOME/betterschools.com.au/gap-finder/     the website
$HOME/gap-finder-private/                   bootstrap, mail helper, example config
$HOME/gap-finder-private/throttle/          rate-limit timestamps only, mode 0700
```

**3. Private config**

1. In File Manager, open `$HOME/gap-finder-private/` and confirm it is not inside `betterschools.com.au` or `public_html`.
2. Copy `config.example.php` to `config.php` in that same directory.
3. `FEEDBACK_TO` is already `info@betterschools.com.au`. That public Better Schools address is the default. Change it in this private `config.php` only if feedback should go somewhere else. Do not commit that change.
4. Leave `FEEDBACK_FROM` as `noreply@betterschools.com.au`. The host must allow that envelope sender.
5. Set the file mode to `600`. Deploy will not overwrite `config.php`.
6. Click **Deploy HEAD Commit** again so permissions and `.htaccess` are refreshed.

**4. Password-protect the demo**

Recommended, so the feedback form is not open to the whole internet.

1. Open **cPanel → Files → Directory Privacy**.
2. Open `betterschools.com.au`, then `gap-finder`, then **Edit**.
3. Password-protect the directory, then create a username and a strong password.
4. In a private browser window, `https://betterschools.com.au/gap-finder` should ask for that password before the page loads.

Deploy keeps the `cp:ppd` block. Do not replace the live `.htaccess` with a raw copy from Git.

**5. Later updates**

Merge into GitHub `main`. In cPanel, open **Git Version Control → Manage → Pull or Deploy**, click **Update from Remote**, then **Deploy HEAD Commit**. Do not move `config.php` again.

PHP 8.2 or newer is required, with `mail()` enabled. If `Options -Indexes` causes a 500 error, ask the host to turn directory listing off, remove that one line from `public/.htaccess`, and deploy again.
