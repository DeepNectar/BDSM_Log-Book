    // ============================================================
    // ⬅️⬅️⬅️ NEW: CLOUD SYNC WITH SUPABASE ⬅️⬅️⬅️
    // ============================================================

    // 🔧 STEP 1: PASTE YOUR SUPABASE CREDENTIALS HERE
    const SUPABASE_URL = 'https://sjaxgxsvtldcgvunzeye.supabase.co';       // ⬅️ REPLACE
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqYXhneHN2dGxkY2d2dW56ZXllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2MTQ2MjIsImV4cCI6MjEwNTE5MDYyMn0.JiKiYBGAJCMyDUiArZfRmscTK2XoypBIs1FTNLKpKUQ';          // ⬅️ REPLACE


    let supabaseClient = null;
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.error('Supabase init failed:', e);
    }

    let isSyncing = false;
    let lastSyncTime = null;
    let unsavedChanges = false;   // true when data changed since the last cloud save

    // Auto-sync interval: push pending changes to the cloud every 15 minutes
    // (within your requested 15–20 minute window). Sync also happens whenever
    // you press "Save Data" and whenever the site is reopened/unlocked.
    const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;

    // The list of all sheet bodies your app uses
    const SHEET_IDS = [
      'dailyBody','dailyFeedbackBody','dominantBody','dominantFeedbackBody',
      'bonusBody','sceneBody','toyBody','debriefBody','weeklyBody',
      'finalBody','settingsBody'
    ];

    // ---- Sync badge helpers ----
    function setSyncStatus(status, message) {
      const badge = document.getElementById('syncBadge');
      if (!badge) return;
      badge.className = 'sync-badge ' + status;
      const icon = status === 'online' ? '☁️' : status === 'syncing' ? '🔄' : '⚠️';
      badge.innerHTML = `${icon} ${message}`;
    }

    function updateLastSyncInfo() {
      const badge = document.getElementById('syncBadge');
      if (!badge || !lastSyncTime) return;
      const secs = Math.floor((Date.now() - lastSyncTime) / 1000);
      const status = badge.classList.contains('online') ? 'online' :
                     badge.classList.contains('syncing') ? 'syncing' : 'offline';
      let msg;
      if (secs < 5) msg = 'synced just now';
      else if (secs < 60) msg = `synced ${secs}s ago`;
      else msg = `synced ${Math.floor(secs/60)}m ago`;
      setSyncStatus(status, msg);
    }
    setInterval(updateLastSyncInfo, 5000);

    // ---- Mark data as changed (used by the 15-min auto-sync timer) ----
    function markDirty() {
      unsavedChanges = true;
    }

    // ---- PUSH: send all sheets to cloud ----
    async function pushAllToCloud() {
      if (!supabaseClient) return false;
      if (isSyncing) return false;
      isSyncing = true;
      setSyncStatus('syncing', 'saving...');
      try {
        const rows = [];
        SHEET_IDS.forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            rows.push({ sheet_name: id, html_content: el.innerHTML });
          }
        });

        const { error } = await supabaseClient
          .from('log_book_data')
          .upsert(rows, { onConflict: 'sheet_name' });

        if (error) {
          console.warn('Upsert error:', error);
          setSyncStatus('offline', 'save failed');
          isSyncing = false;
          return false;
        }

        // Cloud save succeeded — no local copy is kept (cloud-only storage).
        unsavedChanges = false;

        lastSyncTime = Date.now();
        setSyncStatus('online', 'synced');
        isSyncing = false;
        return true;
      } catch (e) {
        console.error('pushAllToCloud failed:', e);
        setSyncStatus('offline', 'save failed');
        isSyncing = false;
        return false;
      }
    }

    // ---- PULL: load all sheets from cloud ----
    async function pullAllFromCloud() {
      if (!supabaseClient) return null;
      try {
        const { data, error } = await supabaseClient
          .from('log_book_data')
          .select('sheet_name, html_content, updated_at');

        if (error) {
          console.warn('Pull error:', error);
          return null;
        }

        const result = {};
        (data || []).forEach(row => {
          result[row.sheet_name] = row.html_content || '';
        });
        return result;
      } catch (e) {
        console.error('pullAllFromCloud failed:', e);
        return null;
      }
    }

    // ---- AUTO-SYNC: every 15 minutes, push any new/changed data to the cloud.
    // It does NOT sync on every keystroke — only on this timer, on "Save Data",
    // and when the site is reopened (pull) or brought back to the foreground.
    function startAutoSync() {
      setInterval(async () => {
        if (isSyncing || !supabaseClient) return;
        const mainApp = document.getElementById('mainApp');
        if (!mainApp || mainApp.style.display === 'none') return;
        if (document.hidden) return;            // wait until tab is visible again
        if (!unsavedChanges) return;            // nothing new since last save
        await pushAllToCloud();
      }, AUTO_SYNC_INTERVAL_MS);

      // When you come back to an already-open tab, re-sync both ways:
      // push local pending changes, then pull anything saved elsewhere.
      document.addEventListener('visibilitychange', async () => {
        if (document.hidden || isSyncing || !supabaseClient) return;
        const mainApp = document.getElementById('mainApp');
        if (!mainApp || mainApp.style.display === 'none') return;
        if (unsavedChanges) {
          await pushAllToCloud();
        } else {
          await pullIntoSheets(true);
        }
      });
    }

    // ---- Pull cloud data into the sheet bodies (used on reopen & force sync) ----
    async function pullIntoSheets(silentIfEmpty) {
      const pulled = await pullAllFromCloud();
      if (!pulled || Object.keys(pulled).length === 0) {
        if (!silentIfEmpty) showToast('☁️ No cloud data yet');
        return false;
      }
      SHEET_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el || pulled[id] === undefined) return;
        // Never overwrite the field the user is currently typing in.
        if (activeEditEl && el.contains(activeEditEl)) return;
        el.innerHTML = pulled[id];
      });
      lastSyncTime = Date.now();
      unsavedChanges = false;
      setSyncStatus('online', 'synced');
      return true;
    }

    // ---- FORCE SYNC button (pull latest from cloud) ----
    async function forceSync() {
      showToast('🔄 Syncing...');
      if (!supabaseClient) {
        setSyncStatus('offline', 'no cloud');
        showToast('⚠️ Cloud not configured');
        return;
      }
      const ok = await pullIntoSheets(false);
      if (ok) {
        showToast('☁️ Synced from cloud!');
      } else {
        setSyncStatus('offline', 'sync failed');
        showToast('⚠️ Sync failed');
      }
    }

    // ---- CLEAR ALL DATA FROM THE CLOUD ----
    // Permanently deletes every saved row from the Supabase table, resets all
    // sheets in the UI to blank rows, and stops any pending auto-sync from
    // re-uploading the old data. This action cannot be undone.
    async function clearAllCloudData() {
      if (!supabaseClient) {
        showToast('⚠️ Cloud not configured — cannot clear');
        return;
      }
      const ok = confirm(
        '🗑️ CLEAR ALL DATA FROM THE CLOUD\n\n' +
        'This permanently deletes ALL saved data for every tab from the cloud.\n' +
        'It cannot be undone.\n\n' +
        'Are you absolutely sure? (Press OK to delete everything)'
      );
      if (!ok) return;

      const sure2 = confirm('⚠️ Final confirmation:\nDelete ALL cloud data right now?');
      if (!sure2) return;

      setSyncStatus('syncing', 'clearing...');
      try {
        // Delete every row in the table (anon key is scoped to this one table).
        const { error } = await supabaseClient
          .from('log_book_data')
          .delete()
          .neq('sheet_name', '__never_matches__');   // matches all rows

        if (error) {
          console.warn('Cloud delete error:', error);
          setSyncStatus('offline', 'clear failed');
          showToast('⚠️ Could not clear cloud data: ' + error.message);
          return;
        }

        // Reset the UI to blank tables so nothing stale remains on screen.
        initTables();

        // Keep the timer from pushing anything back up automatically.
        unsavedChanges = false;
        lastSyncTime = Date.now();
        setSyncStatus('online', 'cleared');
        showToast('🗑️ All cloud data deleted. Tables are blank now.');
      } catch (e) {
        console.error('clearAllCloudData failed:', e);
        setSyncStatus('offline', 'clear failed');
        showToast('⚠️ Clear failed: ' + e.message);
      }
    }

    // ---- INIT CLOUD SYNC (runs when the site is reopened & unlocked) ----
    async function initCloudSync() {
      // One-time cleanup: remove any old local copy so NO data stays on device.
      try { localStorage.removeItem('bdsm_log_data'); } catch (e) {}

      if (!supabaseClient) {
        setSyncStatus('offline', 'no cloud');
        return;
      }

      setSyncStatus('syncing', 'connecting...');
      const pulled = await pullAllFromCloud();

      if (pulled && Object.keys(pulled).length > 0) {
        SHEET_IDS.forEach(id => {
          const el = document.getElementById(id);
          if (el && pulled[id] !== undefined) {
            el.innerHTML = pulled[id];
          }
        });
        lastSyncTime = Date.now();
        unsavedChanges = false;
        setSyncStatus('online', 'synced');
        showToast('☁️ Loaded from cloud!');
      } else {
        setSyncStatus('syncing', 'uploading...');
        await pushAllToCloud();
        showToast('☁️ First sync complete');
      }

      startAutoSync();
    }

    // ===== CREATE MIST PARTICLES =====
    function createMist() {
      const container = document.getElementById('mistContainer');
      for (let i = 0; i < 15; i++) {
        const mist = document.createElement('div');
        mist.className = 'mist-particle';
        const size = 100 + Math.random() * 200;
        mist.style.width = size + 'px';
        mist.style.height = (size * 0.4) + 'px';
        mist.style.top = Math.random() * 100 + '%';
        mist.style.animationDuration = (25 + Math.random() * 35) + 's';
        mist.style.animationDelay = (Math.random() * 20) + 's';
        mist.style.opacity = 0.3 + Math.random() * 0.3;
        container.appendChild(mist);
      }
    }

    // ===== CREATE FLOATING HEARTS =====
    function createHearts() {
      const container = document.getElementById('heartsContainer');
      const heartSymbols = ['♥', '❤', '♡'];
      for (let i = 0; i < 30; i++) {
        const heart = document.createElement('div');
        heart.className = 'heart-particle';
        heart.textContent = heartSymbols[Math.floor(Math.random() * heartSymbols.length)];
        heart.style.left = Math.random() * 100 + '%';
        heart.style.fontSize = (12 + Math.random() * 22) + 'px';
        heart.style.animationDuration = (18 + Math.random() * 30) + 's';
        heart.style.animationDelay = (Math.random() * 25) + 's';
        heart.style.color = `rgba(${180 + Math.random() * 75}, ${60 + Math.random() * 60}, ${140 + Math.random() * 80}, ${0.06 + Math.random() * 0.10})`;
        container.appendChild(heart);
      }
    }

    // ===== CREATE SPARKLES =====
    function createSparkles() {
      const body = document.body;
      for (let i = 0; i < 40; i++) {
        const sparkle = document.createElement('div');
        sparkle.className = 'sparkle';
        sparkle.style.left = Math.random() * 100 + '%';
        sparkle.style.top = Math.random() * 100 + '%';
        sparkle.style.width = (2 + Math.random() * 4) + 'px';
        sparkle.style.height = sparkle.style.width;
        sparkle.style.animationDuration = (3 + Math.random() * 6) + 's';
        sparkle.style.animationDelay = (Math.random() * 8) + 's';
        sparkle.style.background = `radial-gradient(circle, rgba(${200 + Math.random() * 55}, ${120 + Math.random() * 80}, ${180 + Math.random() * 75}, ${0.25 + Math.random() * 0.35}), transparent)`;
        body.appendChild(sparkle);
      }
    }

    // Initialize background animations
    createMist();
    createHearts();
    createSparkles();

    // ===== PASSWORD - COMPLETELY HIDDEN AFTER LOGIN =====
    const PASSWORD = "Deepnectar@1612@";
    const overlay = document.getElementById('passwordOverlay');
    const pwInput = document.getElementById('passwordInput');
    const unlockBtn = document.getElementById('unlockBtn');
    const pwError = document.getElementById('pwError');
    const togglePwBtn = document.getElementById('togglePwBtn');

    let pwVisible = false;
    togglePwBtn.addEventListener('click', function() {
      pwVisible = !pwVisible;
      pwInput.type = pwVisible ? 'text' : 'password';
      this.innerHTML = pwVisible ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
    });

        function unlockApp() {
      if (pwInput.value === PASSWORD) {
        overlay.classList.add('hidden');
        setTimeout(() => {
          overlay.style.display = 'none';
        }, 800);
        pwError.textContent = '';
        pwInput.value = '';
        document.getElementById('mainApp').style.display = 'block';
        initTables();
        showToast('🔓 Unlocked successfully!');
        
        // ⬅️ NEW: Start cloud sync after tables are initialized
        setTimeout(initCloudSync, 500);
      } else {
        pwError.textContent = '❌ Wrong password. Try again.';
        pwInput.value = '';
        pwInput.focus();
      }
    }

    unlockBtn.addEventListener('click', unlockApp);
    pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlockApp(); });

    // ===== TOAST =====
    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.display = 'block';
      clearTimeout(t._timeout);
      t._timeout = setTimeout(() => { t.style.display = 'none'; }, 3000);
    }

    // ===== TAB SWITCH =====
    document.querySelectorAll('.tab-nav button').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.tab-nav button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const tab = this.dataset.tab;
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.getElementById('panel-' + tab).classList.add('active');
      });
    });

    // ===== EXTENDED DROPDOWN LISTS =====
    const LISTS = {
      mood: ['1','2','3','4','5','6','7','8','9','10'],
      followed: ['Yes','No','Partially','Mostly','Almost','Completely','Not Yet','Working On It','Getting There','Almost There','Absolutely','Definitely','Sometimes','Rarely','Never','Always','Consistently','Intermittently','Progressing','Struggling','Succeeding'],
      feelings: ['Loved','Safe','Happy','Grateful','Content','Anxious','Tired','Stressed','Neutral','Connected','Peaceful','Excited','Nervous','Relaxed','Empowered','Vulnerable','Strong','Beautiful','Adored','Cherished','Protected','Free','Playful','Submissive','Dominant','Proud','Thankful','Blissful','Ecstatic','Calm','Restless','Curious','Intense','Deep','Satisfied','Fulfilled','Complete','Radiant','Serene','Trusting','Brave','Surrendered','Worthy','Energized','Soothing','Passionate','Tender','Captivated','Transformed','Alive','Hopeful','Joyful','Peaceful','Confident','Secure','Valued','Respected','Honored','Nurtured','Inspired','Motivated','Grounded','Centered','Balanced','Harmonious','Euphoric','Rapturous','Enchanted','Mesmerized','Awestruck','Giddy','Affectionate','Devoted','Loyal','Faithful','Committed'],
      feedbackPraise: ['Excellent','Great','Good','Needs Improvement','Keep Going','Proud of You','Amazing','Beautiful','Outstanding','Fantastic','Brilliant','Spectacular','Wonderful','Incredible','Superb','Marvelous','Terrific','Fabulous','Awesome','Perfect','Loved It','Impressive','Remarkable','Exceptional','Stellar','Magnificent','Sublime','Inspiring','Phenomenal','Extraordinary','Unforgettable','Heavenly','Divine','Radiant','Glorious','Majestic','Exquisite','Captivating','Enchanting','Mesmerizing','Awe-inspiring','Breathtaking','Transcendent','Supreme','Ultimate','Peerless','Unmatched','Incomparable'],
      honeyFeedback: ['Amazing','Incredible','Thank You','Appreciated','Perfect','Great','Beautiful','Loved It','Outstanding','Fantastic','Brilliant','Spectacular','Wonderful','Superb','Marvelous','Terrific','Fabulous','Awesome','Impressive','Remarkable','Exceptional','My King','My Dominant','So Proud','You\'re Amazing','Best Man','My Treasure','Simply Perfect','Truly Beautiful','You Inspire Me','Grateful','My Hero','My World','My Anchor','My Strength','My Peace','My Joy','My Everything','My Heart','My Soul','My Forever','My One','My All','My Love','My Life','My Sun','My Moon','My Stars','My Universe'],
      whoEarned: ['Honey','Deep','Both','Mutual','Shared','Together','Each Other','Team Effort','Collaborative'],
      bonusReasons: ['Excellent behavior','Extra effort','Following rules','Good attitude','Helping others','Self care','Pushing limits','Being vulnerable','Communication','Going above and beyond','Being patient','Showing love','Being honest','Trust building','Emotional support','Physical endurance','Creative scene','New experience','Overcoming fear','Being present','Active listening','Showing gratitude','Being playful','Maintaining boundaries','Aftercare excellence','Service attitude','Being obedient','Being dominant','Being submissive','Exceptional devotion','Bravery','Kindness','Patience','Grace','Courage','Resilience','Empathy','Vulnerability','Strength','Dedication','Commitment','Growth','Healing','Connection','Intimacy','Surrender','Leadership','Care','Nurturing','Protection','Guidance','Wisdom','Understanding','Acceptance','Forgiveness','Encouragement','Support','Affection','Devotion','Loyalty','Faithfulness','Consistency','Reliability','Dependability','Trustworthiness','Honesty','Integrity'],
      safeWords: ['No','Green','Yellow','Red','Not Needed','Not Used','Used Green','Used Yellow','Used Red','Pause','Stop','Check-in','Slow Down','Full Stop','Continue','Hold','Wait','Breathe','Time Out','Mercy','Enough','Please','Help','Need Break','Need Space','Too Much','Perfect','Good','Harder','Softer','Slower','Faster','More','Less','Keep Going','Take Control','Let Go','Trust','Safe','Unsafe','Comfort','Discomfort'],
      aftercare: ['Yes','No','Partially','Completely','Mostly','Not Yet','Extended','Short','Thorough','Minimal','Cuddled','Hydrated','Talked','Massaged','Rested','Snacked','Wrapped','Held','Soothed','Comforted','Reassured','Pampered','Nurtured','Cared For','Loved','Adored','Cherished','Protected','Safe','Warm','Cozy','Peaceful','Relaxed','Content','Happy','Tender','Gentle','Soft','Calm','Quiet','Silent','Connected','Intimate'],
      safeLoved: ['Yes','No','Somewhat','Mostly','Completely','Absolutely','Not Really','Partially','Almost','Entirely','Totally','Deeply','Fully','Wholly','Utterly','Unconditionally','Genuinely','Truly','Authentically','Profoundly','Unquestionably','Undoubtedly','Certainly'],
      renewal: ['Yes','No','Maybe','Not Sure','Definitely','Absolutely','Probably','Undecided','Considering','Discussing','Planning','Committed','Interested','Curious','Open','Enthusiastic','Eager','Ready','Prepared','Willing','Desiring','Longing','Yearning','Craving','Need','Want','Choose','Decide'],
      newToy: ['Yes','No','Maybe','Not Applicable','Will Try Later','Already Used','Excited To Try','Curious','Intrigued','Nervous','Anxious','Eager','Ready','Prepared','Planning','Considering','Discussing','Looking Forward','Can\'t Wait','Soon','Eventually','Someday','Interested','Open','Willing'],
      toyRefused: ['Yes','No','Not Applicable','Not Yet','Maybe Later','Declined','Postponed','Temporarily','Not Comfortable','Not Ready','Need More Time','Too Intense','Too Much','Not Now','Later','Never','Avoiding','Skipping','Passing','Opting Out'],
      fulfilled: ['Yes','No','Partially','Mostly','Completely','Not Yet','Working On It','Almost','Getting There','Achieved','Exceeded','Met','In Progress','Developing','Growing','Improving','Advancing','Progressing','Succeeding','Struggling','Learning','Adapting','Overcoming','Persevering','Continuing','Dedicated','Committed','Focused','Determined','Resolute','Steadfast'],
      sceneFeelings: ['Loved','Safe','Happy','Grateful','Content','Anxious','Tired','Stressed','Neutral','Connected','Peaceful','Excited','Nervous','Relaxed','Empowered','Vulnerable','Strong','Beautiful','Adored','Cherished','Protected','Free','Playful','Submissive','Dominant','Proud','Thankful','Blissful','Ecstatic','Calm','Intense','Deep','Satisfied','Fulfilled','Complete','Radiant','Serene','Trusting','Brave','Surrendered','Worthy','Energized','Soothing','Passionate','Tender','Captivated','Transformed','Alive','Hopeful','Joyful','Peaceful','Confident','Secure','Valued','Respected','Honored','Nurtured','Inspired','Motivated','Grounded','Centered','Balanced','Harmonious','Euphoric','Rapturous','Enchanted','Mesmerized','Awestruck','Giddy','Affectionate','Devoted','Loyal','Faithful','Committed','Exhilarated','Thrilled','Elated','Overjoyed','Delighted','Pleased','Glad','Cheerful','Bright','Luminous','Radiant','Glowing'],
      dominantFeelings: ['Loved','Safe','Happy','Grateful','Content','Anxious','Tired','Stressed','Neutral','Connected','Peaceful','Excited','Nervous','Relaxed','Empowered','Vulnerable','Strong','Beautiful','Adored','Cherished','Protected','Free','Playful','Submissive','Dominant','Proud','Thankful','Blissful','Ecstatic','Calm','Controlled','Powerful','Responsible','Caring','Protective','Guiding','Firm','Tender','Assertive','Confident','Wise','Patient','Devoted','Worthy','Respected','Honored','Valued','Appreciated','Admired','Looked Up To','Trusted','Relied Upon','Supported','Encouraged','Leading','Directing','Shaping','Molding','Guarding','Watching','Holding','Containing','Directing','Channeling','Focusing','Intention','Purpose','Clarity','Strength','Resolve','Determination','Commitment']
    };

    function makeSelect(options, placeholder='') {
      let html = `<select><option value="">${placeholder}</option>`;
      options.forEach(o => html += `<option value="${o}">${o}</option>`);
      html += '</select>';
      return html;
    }

    // ===== INIT TABLES =====
    function initTables() {
      document.getElementById('dailyBody').innerHTML = rowDaily();
      document.getElementById('dailyFeedbackBody').innerHTML = feedbackRow('dailyFeedbackBody');
      document.getElementById('dominantBody').innerHTML = rowDominant();
      document.getElementById('dominantFeedbackBody').innerHTML = feedbackRow('dominantFeedbackBody');
      document.getElementById('bonusBody').innerHTML = rowBonus();
      document.getElementById('sceneBody').innerHTML = rowScene();
      document.getElementById('toyBody').innerHTML = rowToy();
      document.getElementById('debriefBody').innerHTML = rowDebrief();
      document.getElementById('weeklyBody').innerHTML = rowWeekly('Week 1');
      renderFinal();
      renderSettings();
      // No local loading — data comes only from the cloud (initCloudSync).
    }

    // ===== ROW GENERATORS =====
    function rowDaily() {
      const d = new Date().toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
      return `<tr><td><input type="text" value="${d}"></td>
        <td>${makeSelect(LISTS.mood)}</td>
        <td>${makeSelect(LISTS.followed)}</td>
        <td><input type="text" placeholder="Explain..."></td>
        <td><input type="text" placeholder="Favorite moment"></td>
        <td><input type="text" placeholder="Tomorrow..."></td>
        <td>${makeSelect(LISTS.feelings)}</td></tr>`;
    }
    function rowDominant() {
      const d = new Date().toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
      return `<tr><td><input type="text" value="${d}"></td>
        <td>${makeSelect(LISTS.mood)}</td>
        <td><input type="text" placeholder="Care..."></td>
        <td>${makeSelect(LISTS.fulfilled)}</td>
        <td><input type="text" placeholder="If no..."></td>
        <td><input type="text" placeholder="Proud of..."></td>
        <td><input type="text" placeholder="Improve..."></td>
        <td>${makeSelect(LISTS.dominantFeelings)}</td></tr>`;
    }
    function rowBonus() {
      const d = new Date().toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
      return `<tr><td><input type="text" value="${d}"></td>
        <td>${makeSelect(LISTS.whoEarned)}</td>
        <td>${makeSelect(LISTS.bonusReasons)}</td>
        <td><input type="text" placeholder="Bonus given"></td>
        <td>${makeSelect(LISTS.followed)}</td>
        <td><input type="text" placeholder="Notes"></td></tr>`;
    }
    function rowScene() {
      const d = new Date().toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
      return `<tr><td><input type="text" value="${d}"></td>
        <td><input type="text" placeholder="Duration"></td>
        <td><input type="text" placeholder="Activities"></td>
        <td>${makeSelect(LISTS.safeWords)}</td>
        <td>${makeSelect(LISTS.mood)}</td>
        <td>${makeSelect(LISTS.aftercare)}</td>
        <td><input type="text" placeholder="Notes"></td>
        <td>${makeSelect(LISTS.sceneFeelings)}</td></tr>`;
    }
    function rowToy() {
      const d = new Date().toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
      return `<tr><td><input type="text" value="${d}"></td>
        <td><input type="text" placeholder="Toys used"></td>
        <td>${makeSelect(LISTS.newToy)}</td>
        <td>${makeSelect(LISTS.toyRefused)}</td>
        <td><input type="text" placeholder="Notes"></td>
        <td>${makeSelect(LISTS.feelings)}</td></tr>`;
    }
    function rowDebrief() {
      const d = new Date().toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
      return `<tr><td><input type="text" value="${d}"></td>
        <td><input type="text" placeholder="Favorite moment"></td>
        <td><input type="text" placeholder="Uncomfortable?"></td>
        <td>${makeSelect(LISTS.safeLoved)}</td>
        <td><input type="text" placeholder="Want more"></td>
        <td><input type="text" placeholder="Want less"></td>
        <td>${makeSelect(LISTS.mood)}</td>
        <td><input type="text" placeholder="Notes"></td></tr>`;
    }
    function rowWeekly(week) {
      return `<tr><td><input type="text" value="${week}"></td>
        <td><input type="text" placeholder="Biggest win"></td>
        <td><input type="text" placeholder="Challenge"></td>
        <td><input type="text" placeholder="Learned"></td>
        <td><input type="text" placeholder="Goal next week"></td>
        <td><input type="text" placeholder="Notes"></td></tr>`;
    }
    function feedbackRow(targetId) {
      const d = new Date().toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
      const list = targetId.includes('dominant') ? LISTS.honeyFeedback : LISTS.feedbackPraise;
      return `<tr><td><input type="text" value="${d}"></td><td>${makeSelect(list)}</td></tr>`;
    }

    // ===== ADD ROW =====
    function addRow(sheet) {
      const map = {
        daily: { body:'dailyBody', fn:rowDaily },
        dominant: { body:'dominantBody', fn:rowDominant },
        bonus: { body:'bonusBody', fn:rowBonus },
        scene: { body:'sceneBody', fn:rowScene },
        toy: { body:'toyBody', fn:rowToy },
        debrief: { body:'debriefBody', fn:rowDebrief },
        weekly: { body:'weeklyBody', fn:()=>rowWeekly('Week '+(document.getElementById('weeklyBody').children.length+1)) }
      };
      const entry = map[sheet];
      if (entry) {
        document.getElementById(entry.body).innerHTML += entry.fn();
        markDirty();
        showToast('✅ Row added!');
      }
    }

    function addFeedbackRow(targetId) {
      const d = new Date().toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
      const list = targetId.includes('dominant') ? LISTS.honeyFeedback : LISTS.feedbackPraise;
      document.getElementById(targetId).innerHTML += `<tr><td><input type="text" value="${d}"></td><td>${makeSelect(list)}</td></tr>`;
      markDirty();
      showToast('✅ Feedback row added!');
    }

    // ===== SAVE DATA (cloud only — nothing is stored on the device) =====
    async function saveAllData() {
      try {
        if (!supabaseClient) {
          showToast('⚠️ Cloud not configured — cannot save');
          return;
        }
        showToast('💾 Saving to cloud...');
        const ok = await pushAllToCloud();
        if (ok) {
          showToast('💾 All data saved to cloud!');
        } else {
          showToast('⚠️ Save failed — check your connection and try again');
        }
      } catch(e) {
        showToast('⚠️ Save error: ' + e.message);
      }
    }

    // ===== TRACK EDITS =====
    // Any typing/selection change marks data as "pending" so the 15-minute
    // auto-sync timer knows there is something new to push to the cloud.
    // Uses event delegation on document, so it also covers rows added later
    // and fields loaded from the cloud. Inputs are protected from being
    // wiped by a background pull while you are actively typing in one.
    let activeEditEl = null;
    function isInSheet(target) {
      if (!target || !target.closest) return false;
      return !!target.closest('#' + SHEET_IDS.join(', #'));
    }
    document.addEventListener('input',  (e) => { if (isInSheet(e.target)) markDirty(); }, true);
    document.addEventListener('change', (e) => { if (isInSheet(e.target)) markDirty(); }, true);
    document.addEventListener('focusin',  (e) => { activeEditEl = isInSheet(e.target) ? e.target : null; });
    document.addEventListener('focusout', () => { activeEditEl = null; });

    // No local storage loading anymore — all data lives in the cloud.

    // ===== FINAL SUMMARY =====
    function renderFinal() {
      const body = document.getElementById('finalBody');
      const rows = [
        ['Contract Start Date:', '<input type="text" placeholder="e.g. Jun 14, 2026">'],
        ['Contract End Date:', '<input type="text" placeholder="e.g. Jul 14, 2026">'],
        ['Total Number of Scenes:', '<input type="text" id="finalScenes" value="0">'],
        ['Total Bonuses Earned (Honey):', '<input type="text" id="finalHoneyBonus" value="0">'],
        ['Total Bonuses Earned (Deep):', '<input type="text" id="finalDeepBonus" value="0">'],
        ['Safe Words Used:', '<input type="text" id="finalSafeWords" value="None used">'],
        ['Favorite Scene Overall:', '<input type="text" id="finalFavorite" placeholder="Favorite scene">'],
        ['Biggest Lesson Learned:', '<input type="text" id="finalLesson" placeholder="Lesson learned">'],
        ['Would You Renew This Contract?', makeSelect(LISTS.renewal, 'Select...')],
        ['If Yes, What Would You Change?', '<input type="text" placeholder="Change...">'],
        ['If No, Why Not?', '<input type="text" placeholder="Why not...">'],
        ['Final Thoughts:', '<input type="text" placeholder="Final thoughts">']
      ];
      body.innerHTML = rows.map(r => `<tr><td style="width:40%;font-weight:500;color:#c8bcd0;">${r[0]}</td><td>${r[1]}</td></tr>`).join('');
    }

    function refreshFinal() {
      const sceneRows = document.getElementById('sceneBody').children.length;
      document.getElementById('finalScenes').value = sceneRows;
      let honey=0, deep=0;
      document.getElementById('bonusBody').querySelectorAll('tr').forEach(row => {
        const sel = row.querySelector('td:nth-child(2) select');
        if (sel) {
          const val = sel.value.toLowerCase();
          if (val==='honey') honey++;
          else if (val==='deep') deep++;
        }
      });
      document.getElementById('finalHoneyBonus').value = honey;
      document.getElementById('finalDeepBonus').value = deep;
      let safeSet = new Set();
      document.getElementById('sceneBody').querySelectorAll('tr').forEach(row => {
        const sel = row.querySelector('td:nth-child(4) select');
        if (sel && sel.value && !['no','not needed','not used'].includes(sel.value.toLowerCase())) {
          safeSet.add(sel.value);
        }
      });
      document.getElementById('finalSafeWords').value = [...safeSet].join(', ') || 'None used';
      const sceneRowsList = document.getElementById('sceneBody').querySelectorAll('tr');
      if (sceneRowsList.length) {
        const last = sceneRowsList[sceneRowsList.length-1];
        const act = last.querySelector('td:nth-child(3) input');
        if (act && act.value) document.getElementById('finalFavorite').value = act.value;
      }
      const weeklyRows = document.getElementById('weeklyBody').querySelectorAll('tr');
      if (weeklyRows.length) {
        const last = weeklyRows[weeklyRows.length-1];
        const learn = last.querySelector('td:nth-child(4) input');
        if (learn && learn.value) document.getElementById('finalLesson').value = learn.value;
      }
      showToast('🔄 Final summary refreshed!');
    }

    // ===== SETTINGS =====
    function renderSettings() {
      const body = document.getElementById('settingsBody');
      const details = [
        ['Deep (The Dominant / Top)', '<input type="text" id="settingDeep" placeholder="Deep" value="Deep">'],
        ['Honey (The Submissive / Bottom)', '<input type="text" id="settingHoney" placeholder="Honey" value="Honey">'],
        ['Contract Duration:', '<input type="text" id="settingDuration" placeholder="e.g. 1 month" value="30 days">'],
        ['Start Date:', '<input type="text" id="settingStart" placeholder="Jun 14, 2026" value="Jun 14, 2026">'],
        ['End Date:', '<input type="text" id="settingEnd" placeholder="Jul 14, 2026" value="Jul 14, 2026">'],
        ['Contract Type:', '<input type="text" id="settingType" placeholder="e.g. 24/7, scene‑based" value="24/7">'],
        ['Safe Words: GREEN / YELLOW / RED', '<input type="text" id="settingSafe" placeholder="GREEN, YELLOW, RED" value="GREEN, YELLOW, RED">']
      ];
      body.innerHTML = details.map(r => `<tr><td style="width:40%;font-weight:500;color:#c8bcd0;">${r[0]}</td><td>${r[1]}</td></tr>`).join('');
    }

    function applySettings() {
      const deep = document.getElementById('settingDeep')?.value || 'Deep';
      const honey = document.getElementById('settingHoney')?.value || 'Honey';
      const start = document.getElementById('settingStart')?.value || 'Jun 14, 2026';
      const end = document.getElementById('settingEnd')?.value || 'Jul 14, 2026';
      
      document.querySelector('.log-header h1').innerHTML = `<i class="fas fa-heart"></i> ${deep.toUpperCase()} & ${honey.toUpperCase()} <i class="fas fa-heart"></i>`;
      const finalRows = document.querySelectorAll('#finalBody tr');
      if (finalRows.length >= 2) {
        const inputs = finalRows[0].querySelectorAll('input');
        if (inputs.length) inputs[0].value = start;
        if (finalRows[1]) {
          const inp2 = finalRows[1].querySelector('input');
          if (inp2) inp2.value = end;
        }
      }
      showToast(`✅ Settings applied: ${deep} & ${honey}`);
      markDirty();   // settings changes also get saved to the cloud
    }

    // ============================================================
    // EMBEDDED IMAGE FALLBACKS (sign images, logo, love stamp)
    // ------------------------------------------------------------
    // The sign images are hosted on Google (lh3.googleusercontent.com).
    // If a viewer's device/mail client blocks or fails to load them, the
    // PDF / HTML email would show blank signature spaces. These base64
    // data-URLs are embedded directly in this file, so they ALWAYS come
    // through when you copy the HTML code into an email or a PDF:
    //   1. On screen (index.html .sig-img) via sigFallback() onerror hook
    //   2. In the printed/PDF document via embedEmbeddedImages()
    //   3. In the emailed HTML report via INLINE <img src="data:...">
    // To replace with your own exported files later: open the image, run
    //   fetch('img.png').then(r=>r.blob()).then(b=>{const fr=new FileReader();
    //   fr.onload=()=>console.log(fr.result);fr.readAsDataURL(b);})
    // and paste the result below.
    // ============================================================
const LOGO_DATA_URL = 'data:image/png;base64,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';
const STAMP_DATA_URL = 'data:image/png;base64,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';
const DEEP_SIGN_DATA_URL = 'data:image/png;base64,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';
const HONEY_SIGN_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAloAAAEGCAMAAACKIcvJAAADAFBMVEUAAABUlvlsp/pHivYvePQ6hPeGuft5s/yUxfwAAP5jnPf+/v4A//9+fv5VqPwYZvCt1v0la/AAfv5coftupvejy/tQiOtXlPRNiO5///9QiOxLiPFwpvY8fflMiPBKiPJYlfRql/NwpvVpme1zpvNZlfIQWe1ZlfJxpvRlmfFlm/Jlm/Rmme9lmvFUVf6pqf5zpvGHtvd9vP1YlPKIt/cFVfhzpvFSiexNeus2d+yQtvRVVapDe/AAf384eO02del/f384d+tUlPLJ5vxRetVYlPE2d+w2efAxZ9JHe+c/f7+MuPSIt/ZFfOmw//8AAHwAALV6svqJt/ar1/Ntl9QtaehVqqoylvGDrfaMuPU/v/+VyPkkYt8wZ+9EfOgEVawAqv//AP8ccfWMqO0saucDKtYxZ9ZrjOh6sfiVxPrR2+ouWdQkZeQTVtQ1edcGJqoBN84LSNMjWduzvfWpx/MAANI8g/WcrNiWxPoBPLq64f0gXbVXiddDfOp5s/dDfOmWxPeVw/onaehUcK5MedZ6qNSnzPiWw/lqidN8sviGqeys0/h+fr5jjOd/v7+kyvnS/Pwraut6s/qDrPClyfcAAJU6gfJWl9xV/////38MSNMqWOglXOsna+tIbNUAG9E7PbxBeul7sviEq/Cd0f2z1fj//wABOvYGSugWWNlPYuNjidqYxfoGSugRWOccs7M8gfNJedpweM6WmdGqqqrO6fr/f////68TZes7Pfw6c9lultyUmf2us7oPWuUSZdJmZsxmzPyUt9ipZKmjzPqu0/nX8/4AAFZ4BvhmZv92lbOBq/DB3Pv//9UCKu0HS+U8gfOErPOt9q0A/wB//3+o0vzO6vn/AADuqeVXV1160vT/srIVIn8xbnhHe92vavTf5q4AFTs+kvxMZ/JDeN1/AH9/FRVyOazA4PwA/38zzP+qAFW/f3/Uf3//fwD/qgD/v3//zGYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATWBvzAAABAHRSTlMA+/v6+/z6+/sB+QEBAgT7+/sC/NH7LtFvAk6vsAiQz7APjy9PjvxucG2vz06OAwMt0AZQsgcSExJuEgP4ApAvAk0S+Q4wsNEPLQQucE0DAgbQkA4MLwMM+lAEDVwPbQUDAfwSThYvEq7PDxGUEA4KDQ8kCxEJ0BSRB/kKE68vkC+ubwooDlhvEmwrnAQwBNEM0JBvLQexCwMCKhD9rw8OB8tOVvwpAQcPKw4sTfssA5FNDQgDEAIEEgQvKAkGTw4FBQoDsW/8AwMFCrD6Bw4qWZAEAQLNVwEFBAUDBgVuBAcE/f2IAgIEpgIFAwQGAgMEBQAAAAAAAAAAAAAAAAAACUKEDQAAejxJREFUeNrtvYVjHFeWPnqh6hZ1NZOa1SBmlmzLzMx27DjMzMw0SYaZmZl5ZndnZ2aZeffH/Pi9/+Cd75bs2Ilkdct2kpnpm9iWZXVXdd1zz/kOfYex9nqDltN+BO3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXu3VXr/1q1073l7t1T4w7fXGLc9hnh/v8PCl/obf4Yd834+3H017taKVHD8e98fGimOXjRWLq8JXjh1l7Er9L3PFO5hzV+ehT555Qaitydrr/Cvkh4fifii0Khz2vNf8a72TPfBSd2OwP5NvFJKZ5ES2OPfM3EBuN/M8zw+1H18blbz2NkN+3PfXffBcaZq+6xPbj/f07urJZnvS49Xu7mS+2peUknMuLPznitFkX1Lw1Sf34ueL4XB4KHxF2z62F/N9/CKBOCNS/9/xwezhtYMD1/ZUDzyVyfST/CQsyxJYtiCJIrmKSG6aljSjSti2bXGuOH+52pf76Zn3LXp7Dvntx/u7LVjOB4OvH33ulrs3bcjtupHERyku6DdlW4onSJQENxMkQEJKLWEJaRkmrQg38Q2XSy7sqFIin6vl1p78zPYP36ffcnKV08Zfv1MWOhTqOHIkHg6PkWA99xxjm2q7S40HC+WyW06SOEmDG4LkyCSBUYZBQkZfGCRLEcNI0BekosyoMLjJuYFlGqTDpCW4FKYbFdwlASzM1/+xe1qrr3hbef0uCJXjvXWyeBaa+t7OQqbx8n4AJ1sAQElpK2mSuJCGMkkZQX6grgT+jaSM/kgY3FJ2FD9pkyyZJHP4Z5M0m5QGfY0fSJDw2cn543dsoqsMt9H9b7FMrVm3Jhwuxj+Pv+y77s7aV55duzv37vn9yogYpiLtI6F/SEAkaSwRIVkSJoQIS0j8aZpQX66RoB+wVHQjl3bUTgnbtOg3YbjcgBYjGylMrcuUssR/SfRVcms7GQuv8kMLprEtZr8tgQQ/tCb+irv2R97Al2b7khkpLNJHKqHVkckNoChSSyQ+sIIashuSjKHQkMtShsQCXCdkJaLKIqUVADLBSXdFbUAu0mkRepVWcCSh9EUCKk+Wq3fpi4fbuOu3RFEN+cN7Tv/l7vCztVyj0VfIAIlLacZIiugPgydIVEh8bEU+oEmiQUBKAluJq02CU5zcQ2s1JE1C2FwtS/TLsjL7+wrZ2dJ85rOA+WUSK/IirUQMP2YCfhmGNqTalOa7T53c/gzB+jbu+k32+cIhP3552Pc78Lf4+OZt2741Xu1zlWtodRLTeAlyxS03QUIVjdquMsimqRTJT4rcPEsjL7KISkBRcbk1k+SVQqVR6S/0pruz9fHu/KnvXVNLM1ar3bq1PJvevq2Ur0pC8zYpPHrVavozagH+S60GYWTd/PgmQnmXtYXrN3N5Z9mcw5M7q6OWKGQIeZPl48LmIkIahaQrwEXA4fbDdspOpXh0o61SUe5Go4SnuK14pm+i+p73vKfem+/t2X7dDwduY3/I3nL76ff+z8xhc3NemLzL2zZoP/Cd7D98qtSdPJAbmOgXkgQU1lKSXNEFcTEravFKpftZ3GRH2zL+BoUTwpf54TDMzUjvwZFcI7e5t+ImyW65lnb8SGsAhrvYZVMbPK5MYUsrpT77D41oCuomP1hodM/P5tZX8/n87mdCvzj3Gh0QJK+4JrwjHO7wFnSPjroP+b7DnLj3HGPX7yUvYfvAyVtlOZ/NQKxcqC4ANpeblsHLpfQ+vO5HbeX1mwDVsdULXx9vSNEPEEUihNA5Ik6mtkokT7CFBlA6IqEaBSWT/X3JgfvqL27JNMJzbNvCu2iI5l8Vvsf3PzhGAjsZil+2xgmRU3Ba3TjsdAIrFMCnEP0rO1Qk2QuKIkZq97Lp7JayFHnEJQRdMSKFQeIsko3DD9GPTHrtrXvzBhScUMjv0Jjqvrs3Z6vvXj+edAlFkwWSiDABT2shg3MH+G1aBKxIg7iClyuV7Pjj3s21KeactcchFg4P4YuhkLNgXJuPp3uOlj1nVXjytPgdHChlcxX4lVElBZcGGWPbVk/Vv0RiHG7HId5cAoWAguPFQ+HT35nOjVdvVBZ5aHDSbJcbQOsSQCcSQ5STftkEzZVlK/EPoyrT6D553e0nvAWxoT/94XgH4k4XT4+EQiHYSJKd26dYZ5U8UOA6km4kjWw7pXj553OAaMN721v65pAr2v6xjoW/3DVzWzqd6632I5JEhsZSUFA6aM6NLkOZppLSlTB9OqDOMwe6r/1CcSCtX70m/ieXhT3Pv6RJPsc79MesuI3NlvLKFiTZSsHjNLkrhep/+k7tALQN4xsaUfBCZPj8VaHQd+lvmx79P76X+w/j/eUMAkdR5FugDCxuGMI0IkYkEiHIToYRpQoJkxOS3194cWD9ptOAPDw5GQ+9TtYotE7/kesrVPpkyia3Arkiy91omW7/E5956X10P21I//qHEnyP+etYRyAFdLo/8PmfVOvZ/v2NQgZxdKSPrQSJVIJc/QTBZcMwpLIRqCQL6BpSvv9WEr9vbt6cPqQl1Cez54ded4gTv4KE5wvvzJHbQLaQbtxEEA1SJlUme5BQV7Edjnhdrd8w/XY5PXfGevvSAyPb1v91YSIZFLgEyRTSTqZ5tUGKinCVsVrAzERTth1NRY9Z0dFCX/2Rfc88UPuhdiP9NzTP4nthtv1bd73tz1T/aBnJIWWsNhCpj6rM4OPklIbXtXf89QopxB125+Hb2Ibc5dkG52X7pgoBYU4wxSAXHiUJZoQgi86oGFIrMIVkjS0KuQP9yU/1P43iPh2Td/zLht5wQONoR9TrrKfDG54cqFgwjAlyPpRF+Kuxlv7tSEd71y/pBjiOH/fvidM+bNr1jneMnupL9goB4UkQDEZtFOkn+p0jUScspIR1/NO2/8EWjUKhnH/sWsY60+nfw7uReDpH3jRIxnsl2nDLeH7UQiRXSkvhQxR2fxJJqrYEXDKz4cTXBF/t2/RIHVWeQlp2VCsncgINE3/ymJQqpRI2BMt2XVVI8kw5Ozmbu++6e2/4xPs2DHsBfn4zho06wkfIJSkydueXupPkNBrchmhFbbdcfQDosi0EF11ZhfzhIKPMaukNx3OFTCRDsmNY0hR2DDaQpEpaEpEh0l4qKtRGmyefSN5Yn3i2+JMHHtVqATLV8U9kAVf5a97UwHjNMN3rLXnoY1OXR9jRzyZ4lbRWuN2wcVEl6/QXM6XSfDWzdVQZiAHZCAIpyZUZoSV1QYu0UlF7VCQRzSqf6mR31/79XTdoL8whd/KcyPqb/UPH2Ya/mi1rlZXSeSf6eNURxtpxrovnmjvsX+5g963t6entJ6cJMXVhwgVEWN3kCcJWEZN0lUZWgif3F/oKU3sPPZn9kvYeP4CggvebuB+I/8/cqLYK9bCNEnyDWyK/+w72H9sycTG8QJIK5uX6/qwygTon3XllRwnewjFHHjDSZRqoXlDRh6M35SvV7O4ffrGTMLoWpSGfrfJ/gyuCnSGHXZ/Lyf4o6eYIPQArErFH02xHO8q1YpHSgnFVUf9l73aWtaOWpbgZs6I2TINB4ErGJGIMwLgiFY1K9fJ70ndMnXkHtqYj7P02HC7GhtONP8v3C7L4Lno8osl6O/uz0scZvooV46Err2CHBiuN7neP/irv6ro5lKejOyvyNelq64dST1GtjpdKD9a374NAeR8MO2ydv+a3CGeuY+y6bWvz5LJESLAUoqmN7zCvHYdoRpRejV7Zn14DsDr3nrwSruB2VMTIA+SIVxGmkkZERpWrFCEPvr80+69sStdxsj1+6LdJpl55Ij7zOsdvnGhsJcOPQJcl+3LbWDsM0ZIVDMfpMKbTlUz28s7r5wmyI4lMRg8lVsCx0nUN7rovvzspXLevJ9cNoQojTeL/NjN1BNDqP6WTtivJd7GPST46wNrC1fz6yC3026PZPEmULBTKLgqJDSgphKMJXaERgqAWnuqBwsDN9+A1/o6FcNVv+erwvCI7rkTCRXKBG7aYvYO1jeLyy+ss/v1zveXM01/8SEMIZQlyBQlWcCgrWq4gV1DqnkCZrde2dXq36cftF393Dq7jhP3HG+tNyzZRBiRsKzPXlq3zS1UooDTrLCWFUqP9iDzrUnVhclNLFOB7zADkun82PRJesBDxjt81J8lzJmce7VGf5TCKXEWt5AgbbgvQomtdOOBhfK64ofsUAQlu2bayOE8Erevoo9Jt7/AODTHamL0mMA2/o1Gd4GPXJ2yQlBBIsKLJGht+e1uOlloja+/8AHtQFR4kFGVJkFORSEWMBFr0uEDYyuTkJuaz6NB7KPw73Yrg+M5lbO7l/P3oaSO8ZfPcGwjm1+3Y8yZVmh77vc257QPJ5E19WTuFWisCWRFuxqSIRLjFdXMxSVYyPzLQk/ZQc9IuWNL+sFPLCx2LIY1eOs6GVu6U6+aPlgW8w/f9VeHvv2kfkR/aVLhJJDPc3miLhdQyYaoY2UJyCS1lWaS3buzuTt91b3BgQ+3WqYUgTZjdm5GQLI7GxdxK9VZoTRDy8dY1/Qo/5IfPXO3u7gO7HnnzpdEgJ3VlSaUCHj2CD2YsAqohtERsJONoJ7PdXz0RaN7iH7Rb8s5WG2H2Nhd1tFIX0eYWOJ9bh2633NWpv2yyTmdBPd6W3h6uNbpLGWW74282J9UfY2wT22VBT6Fh2STsYES6IigPdRO2sgtPp7O6Z8svhtva6rVrDUvPljUvoRRSZNmm1j0bj21qZPrLpcG+6nRTsnVlmP1tbfrZ8eqgbUtXqI1R2zT7vDeVugrvYez27nJpFNRBBmn2CEkU2oalwROcTGEmq2/Y7/DbSdilVc5JhE7xAC1rfeu6IxTq7COHnKuHH472//j755WtULgY3kNbkXt/si/DOTrMpbJTtojxys/ePPEGxgiLF3eVuQKbmbSEYUBbxSBjXFa6RwoTnyZ9tcMfO9IWoPMZp6kPVYWm4I0J26g7rcrWEMuBc47bth21B1nHebzSYCP2rh3E5aL2sV8rHkUtrxAxq/Am4WYPOT7bdhfbvivJNUuVFAmweciY2WUIU4jSwEHG/nQfeUFtbbW83trxAdprFyFAJcxxdllrL3+IzSp0PLq2LazM+sVNouPoBtw70rn0C6XRz6YIA4MYTKdLQJto2Y03B4z32M9YulJ40FbgHOI62G6AuAwkMVIkewJA6Q23Bau5dUdW8IyRMKTNM1NOa5GZI6yOXifD3CgNSMjYIoKlvYMv1OoFrjQphbCEGbE4mDNMqTQl4l+/GWD8mvBtN+xuJC0y1K6OhUpNwKBpPaWYOLX7OhZHgVsbtTd/VP9+c283akNMzie81hJfjrcqqWVLADfNLiIhns8GGr0P9gmuyy9N01A2vUChAlMY5HwJ6RbmWtFal8Z0ogor158BwyzXoWQyhIbWXUIkuej+HmuzxK4AYDC2mTadEAUXVdaa0xNmWagdsPu60eprezlICeZIiqIg+VUSNPiGbnMRoI2y4NrbovIsa7ZAzguHL0nofh0BgW2NjBSaI9SQHA3zhqaPUdWbnxysE25v90CtYMV/ygYEaRPwjlcPtiRbcXa3Hs4BKmgyiOeGXUNDjM01yLZENSjmfx7lgq6T0nFtaW+0eWpjdLT7LU1LltYaXzl0ocqj49XiWWTskWxSM6JJzBQBkbEB5hj+4PGdjO37QpsBb8XWYIj9B0k4no6r1c2+0VL44qHH0OYoSBdZlevOMWyhMPv2SxWR4Cjl1aSFZuwYYTIlA8poYXOV/OUIYx1NX+xgNTt78lvPeBfURgm2s7NJqejT3zZQESZPqYgBeIXRIsBZIpPDv+/x2mVHF2AUPdbDE0jqC15n320B+RT/7VoNdglAWYVbzgZCdM7rFY2vDCkxQoGD4sA0UJ2PsnHyvfp33caat8Ce94vBhLJHRfYCEJfTsYe9t/5Hr4g/4ggDo8FgJFePrImgFFmSx1ufA4Fse7zDBYJ5hzUKZT11g2/zVrX00iRaDawEeZi1V6IPRybZT6oSkxXE1ZwsIiKzQFl619D+wssFpEpaqO0dYy+iuNOOisHBno6V7bdH/ureQZXbVgskCwpzqsRtuieb4CZiDTEDkT6efPEgu4CcfXudjTe+BW7flCW62aYmX+OzTZX7M3reBnqGMy+dOeBkQeoZPc6KiygCX5AoN4aGKi5cO1k6VXuAhGpPCw0uTmhbBZKv0IFVCsa1tQ6z/mnuV3luv2N/9140Q8Qna+PdGcXB+4E8DjkXKGrgspDtZGy43TZwUdYY61HJUYw64LPNVkGsYl8BZSI3IoZQUjzI9pyRuamqxWOYasVFwlA8IhPCLG8t9OWz9Ylb+0YC+WtJKYTY5WV0u8csm4tkY/PKPubgfkVqT9jH2UG6y85BV0KFugI5Qhj2filSYuu1YyiqaRvCiwW3brhRQU5Iw9SatwSdvaBwNdDZKQ6cBuRhdn0mQbjKdUkKElbKFv2NfHduZG7vO9/J2F1/iIhHPNQqXPJZFnoVgQ40jtbq4VYR1zr2FmkrgnmuPfpEfWb4xCCq+VzwPEo95Y1XJn/cu//FTcxvd/9eTLjFNowSxAaxdGY7KzYb1xq5CbzTGATaPx4U1zhvZel+2qaUZtQwhUoY+frN/7eWDscJhT1nZcXjHvtOhrsIs0rblSI70rLfdoTV4KAGc5cHx1g1iBTDxSUFS9pMVjrZ2HS7rfxirz9gdYxhNMwuY3Sq2YjAPzsvAEtFaGvETT3BzATWWSCpUiDGAX++ocT1bG98uOj7IY+kKuSsMHTg/1sWjqYhubIM+a0VFC86P9gqNYso6dnSJ57XYyWEZQk9NpCsd3kgDTaGdnT0otvEbc/mLb6aS9PKp72mkEaIORMkQjpynbIqB1c5HuscK9nKNHmUYDHCV5UDA+yei6EGwvGcK1wYREPJ7KFDq1oXTq8BJYXogqXyGUOz00pNJCqsiJsp3czeJEUYv23r79n2irBEgtykSpNhQs/51cOoxKQdd7mxnbETPy3lMVyPNs21TFNEo9VtF8e8OGwq+4TQfaVkbnPs6AocRJYTQZYJjqrOP6M22TSNjFkZuPvjf3d5G7pfmhWfZmstW5gRMg/XNpd+KbIR7gq7KxYRtnls8MP3sBLiC8LU444NXujJHn6L71wc0XogbyrgIpKJ7AxKsFvVW078zoqQGE6C7mcbdMcxHiU4GDFL7YEgl3Q5a24vBcNhhTjcFJZx9m47SRskZcT+tVAqM/O8RTuP0BAHXZmbW7CbF2ENsxcxIyZiWgS9r2XTB70W0bbfOXWUjXMzZuhRIEEyR8+Wd/sHD7M/ibfB+6WULfZ761ElIy0+e1WxuQ3fCQZxQv+ocGrkXALwqMLitmm6qfdf78UvFig+wnowFsIwLMNQ/fn9+dmBZ1oBRvpHry3wCNxglCTrtgD6tIUtiQY7z/TItpG8KMtnw/0JkSLpOtCcBzbsPG8jsnW10k0KehKIC+4WUgg9p6YvItnzmj+eq0DRxLg0oGxkfmpHCy8vElTrnUeJX8TA8G8QjXHTLGQHnlubX78S5NZeLbphbHsSJD/cGmkquBVmg7awXVRtIa8TiQidJCTJGs3pf7546wir2a5pANZZlvE1PpFuOv6wZmyYTVXoVfrUoC4r0iVlrGt+XBvBZ9r7/nqsou7ykaZoNGMMnDDLK6HJ8HTK0DBRAaws/p733sA6Ji/urb3T22Vj2KN9TFjuaiu7qUk6Vh34TxcwGAeBfLo7kqwYeYZbHmXxzjBibe19fz1MYugnpYxFWitavctblsrOibMtYB42IiYoFk0C2eTEmdbgRdZYCxryaFKSXrR0crKneYnwt9V70RLH6TYRiUfpDJ0CKRv/FFr+ALUDXRdvHawKiIdVbaIc3Gf1SgWkw2DWMFFDJ1Zz3rjXH7v4XHi/YPUE+aJGMIG52pzsxt8+dw3rRRRLT383glAWl5FYzBDJu9pJ6NcVbh3qxnC+iGH/qpk89cE7dtlkEzHBnSQrIvlq+9I0Fvrs53QRchWuBlma2OU0g7T8PaxR6dGDbQ2TpIngO0iSuewC+bZV+bLflq3XE8k3pE2bZyq1tgmgfBl7vILN4ujaIzDjrp7ovBTUzt6/9CT1/PggaCq+2kRHrnMFe6SeDIYP6qYvfKEsOwLnkLtkwWttMtfXcQ2z41ulwpR2qJ8mDvVtOT0yBC1BIiqq6/d94xLoLIe9rwBDZppkyMgjTd67fAqdbmP6CYleWrwScz5ItsrVMkr1uzT5qJGpOX/f3vLXD8k7uTLiBzwqSs8t05nos1z2MLdVpEv7iKO/mr1kGRPvk1+Hf2EYMahIni8uQ2DiH2TdgzdJE+kBUM1gXDjfUu5hVcslg2gQ+BKmbKut13XNjfdqwmrBrdJiLdFnrT3rMqMPKpcbMXTp8BJ9p3iJilJC7I6CZfCYsZpQUoQnqjPnu1Ao7LGsCJppoVMRzDL6d/27KW9HHcUTmHWCGviRtmi9rqJ1+d9Y3NbEbqPnj0sOs7WwNx8F/hEiv/3mf72E9JHPsBFt2lCxRVdL3nA+teWxsV7dlBZBESwokg1Zve0jIdQ/zJODGOG6wdaq3ue1owuv5xoQbkrG6LhH+++8yj+Parjv3bZldJkRg7t2Zn0hfSmjj77zxcKoIaMIqJMkv386tGR1RuioQ/Bdk/nRfzE95KQw9SeayTXMxknUumTQX2TllvM52pJ3UWENOyDIfbKFoUTjnIbQVyutnC0XePklcj3zf3gJ74puo2eCpzYamoHVLs0tqW8IIO4CSJeShF6ieIz3pacYWwPBD8Wfqxg6eEryadnVNrn56yta/6hcKcnfs5T5+JIm0fdmkoRiLN6FcGmMbCi/hKg4xO7plbZNJi5GMhO15KeX8hGLbF+vbYFNE34hYXXF174tzY6cia4cfhd6b+kfTfpzN2vXar1+q4PVhQF5iaZSsrSUtIQ8VtL7FokYGiYLGT2wDOy/oHhbDlTIUTNiGpYbOyYbXnwJyZq+EfEJkM1I0AYIUXGKX35FxYW9OsiBQRxCK/8hp23zXr81xgYtKZWOTX7qO4tHt5yxe0q6Z1XG0ImIlLalBi8dQYLPNsNrFUYkqGMVg4vHRa5kf5W0oKvAAAyJN83SNeFzZPS9o4YZM9F9Icxk9rrzw6m23F1kDZG2FPYGpejZRQ0PPfGSJMUgI6h+MmAVleD1zkvpy8+WJfl2pE5lF9myXfctsu2rOtnIfovrZmgelDqUM7vYnrM00w42jlQk+Y5cWnL+h3OXtTf89VvD7HNJZSVABMQttdN5rZULD032QSMQXjFjQdIY3e2lzkt4yHewrCRtgzpDhP4Lf/xabUraaT0YvzDxkusqmv5d0/eecF5lWYO2Vp5A02zP4aPt+MPrtxz/RD+30L2KyuQ061wE6fcQUsYGSVChArQIG139l5CD4xDLmvJq9M1CJcn8eCj+6ttm0z2wzIaMxeh/g8tscREk2aNvWfe6SlHu29ku2Hod1xrW7VqWzg1ya3zbq6trnPBHdqOeFLlikeKAylLnTXY6l25Qjc8m9/OYoaOmUF1WgR1Z9yqVlc6AOpmkK8YT3DU+ltvEXjOJIhTfWeG630IYFjomk+k2Kc3rqbfmegqYeit5Qg3e+SrA7FzGesAawyOSDNP850ZJrNDGZcmBS5g3Ce35cVKAuQTNEmTrlFp/9tU6SD8Nah4nCS4j+l0l13udIW8RGe1GOJXuOWYamGvfPdRmZ7skyuCyy4qLYo3uDEJDMWvjxKF956qsMZYD7ZGL0ptK7vrn3YCn2BbuW255ZNUlk3bvoYKlRQGOKTdTgv+3Dey03vJC7HBeN92TqnVdQf894f37mUVl1J/eQj8XC6pNo6JcSrf9wEtiZhZXEf4PKihwssn8uPtvbMydxctGUics5UpSIcI+UOutdVtAZbTdqq/Sc8nCD2QQD1iSuzETkXRb2VKWT4PA+CHWmYXXAXFXKiUi8qbnH1mqWpCAogjKYg1SzPYLH7mhLQcXfV3Zyb40e2r3M+w1LRKevzmjgJjRCyr6Zs6wQPhH0iUXfG2cbFOl755wJ7tDtzOYXEWFWakduVQaIM4O27o1VVgYGydddZr1mcS+s4IOWBMkqUKqCs/UkMFZ/FZCrGHpMXQmlx/l/G9Yu7v1oqMXeqS7RVTxxs3sNU19q1hWKW6jNlnwwRHntGgV2XpMFoDzaJXHUZE3V6DNTAjNesSz05fMIq5i6YpUNli2DBfdHoVbgpbnT7JD6XxQPEOuhEXKNLsrfd3fnodbIHn/hK6XN2BeM4c62lMyL7YWOJjttm3LUub8IRYOv1ruxrcInkrZtjInXth52s55R557OaXgPZqkIsp7Or7hv9SHmSiIPcjkg39w6VSA93fey0j+0f3q3ovVh4ObirO/2gJXFrPrMWPOHa0vkxZ0anNv2Wqg4ZvsuDJzbLotDRd1p0KbnpCWEgkybG4lx14903CMjbjKtXG6R3OdC7bF99iNUQRSEU01btrFOjw4XDYnGyUMPkIg7ZLB+B/sLURBjArXlAvx2ZdJY9JdnWD1URdl+Vy6wOXiwDTd5nIFiWNP6HIuTHnilX0dF2LE/R1jP2pHxs7eKWdTXiiydhiAm7Lli7kiO8eWFUO3TGj6NdoBdbwjiMj7fq/1XxQCXkLIZJ3kih5qnkdlUFqXrU5fuvBDmOUUWUOb6+CDKD+Avv/wGvaJpA1LqHMD9P0exg4tdw+XDbPPZUxETAyUP5yPv3U5ofFvC9zXNl47s67wruW6px4PWArSX5lzq3l9x7vWhIeI0GkAmENFtlYpS6HSk/Td82DG/QYb2w++KtdEZ2xj5tK19q1ih4UenAHWVSEyuX0e28cuf08BPkUQXOdKlg82MSEt5BR7y9Ll6OKweCK/iYVWFpJ32IaBuzfX19/MLqG+/s0C8OyKDtarXCUNO6V5QLjtJsqd/lVn/dAQSz+xn6+Gk6iiI19wkEnZ82k3wi2DE1CZrevdGGYDyjDVah4hEd3FLuHp7WT/gVsu4DqochNW4a0drF6dV1HYQtTOWLDKWz/MJptQgL16ZAry764l8iu0h6FQmA0kkyrKB8c26CFCRf/tP/vdTkmiEOAU6KVMQUc3CE3Dnp0Lt+LsJCiKUeir3BHaj6I3zl1NS2Ukn2SrwlpIf9pLP4LuMmnbNXYJe0Z99lI2xhMYCWSIBBcFtm89nELLDMaBIR3NC+l/14Rwh0GphEogVN/YqrdzbmW39AesJoRS0ZRRqP7l+n1nPd3fYQw/NYitMAnF07bY0AS24gPnJtMctnvLrZq8mxDyrqnOodBDFT0WgF4js52Be+bU5qVr6qlctlXvWHcJAe1edsenTF12CCud7DlezUjXlYYJy4bx7GY5d1eTCrBX21BIpCl5qZRrNdKLmQidf8FG+qArlbLV6MupwZ25kzO5np5/+V0e6zPXXeYIqAPFI1WLKXKkuLKLMB/1GhaONxlAdohtlrSRSpH9yWSf04q/k3W7hH0stCanRIndsO5SmvG//OVGBfquGOnYnnFXWlIZCE+hgiZZ7ns8fbkXb05r39CXTEYiqL5Bqb3c3Syh+YJg0RE8Mvy20mNJoTZutJVUSmjOaSupUurU25l3KYXrTcxUEWfbyi6a1F1MzgEqJ1VAFka+pgTA+T3nejcqaQsJ8vewqQxoQFfHpEyeOL3bkxMKoVUzIUzXtvsGa96lgrM+q92qNoKEsAuhzv5BUqcu7+oyQRJi8VlvE7m1TXZBrmPjJTaBMC86Zq1MzS+2dCdsJM3YepJJZeCWQIPDAUAtTJURfQP7LtnmrfE72Js2fRCKH8lyZZmg10NoR3FTGzR7EfYXJ/SlPts1kIC21e5PWyjL4q4pB7UQ0vGpTaSQYYkS1HfJVLrlHgIgl2YdYSddQUcBVa0SAS5QY7ofFYDw0si3Nlcn1DmGWnuUyELhPtlKzMRh6XkhBntRY0G+taGU5qM36QsMu7LJQPami5dOtzxygnVc3JxHOMSc8EVQCd5Vh/IKUDzCdVQH7e4mT5iyUPQWmcS6FlTrImGKjYWPoZcBxaXl3hlEK8lBauhnSnIldHrP4IXapRr8TRpSD4HF3ELDsgzN60WnApjxXSen2CqnJcWTlqjtok9OyoZXik37df4My23VMRCDfjciMR6FLUQGU+eN6C/RP3f7r2ehi47mQ8NH2PXX92Yee68eB3ex1tAe9i/wYy7CvpF/pCRqRCPSwmA5UMygb6owvcjTOMRe1MEkwf+rQJM0NH/l8engSE6iQF6LnpI2+v1M3lu7VA5SiHVmEPPXU6ERxsIEFFB1E5LubpXPNuzkpI69knNLQuqWr2+ysIae//ZgWKjJUxY3u2KxjKk9HU1K30VqHWReyXL3n/gX+UFgeKSXI63oFnZ/ad9e/+8uCm5ztjFWr378rnrNPzJ29MLmXn2D1ZJ6JBjiVVHS3rCMUibEom6S4+2dRWiLNtRFr4JhmpmXXolipl0ET4VU0B6Erq36pWzq6SF3zES4ALWARiSis+fKNZI3t1rNV2RhSc6LEprNnIT1ZJMm8fNrxysqyg1pmaarG3xjXyPPQpqE+eiMuRgvrCu6ZfZiFq+GIPlOz+B8Kboxqtx3pN6t5fyCjK5Drw93HmGHG7bIvoxgc3CpFVvG+NyGPovrwd10wqyUbQldlCmNxaWCPlJZwpGU4JYlzHzrh2tsjbPwgWs4v4iP2bZLLqeyJ/Z5lwpkOGysgJ6KmKlMMxYBZa6QETLoWw6zVklMJtlmqD1himO6YqN7ao3T1C3cXYnaQQhNh9d0mb6pB3RiUBn8iQjGSglXZooXUbYcx9uXnsA8SJWySbZsqzR3B2PsAshbwsw7gU/018KyLWUr+6nxejZ9eY0ktrgqvIZ5fqtq9+gfduvnEtGF77alO2BQay4WxbIO60yXBdLP5GDDdpT7dt6S7Qzsz6RTIskCfylYJz+LZ3vjfZeuQuWD7FoYxBj4SGOktHTS8P7MZo/9ccsK8NPchJlPcDNRfumdG5o9l14WZxH43dBhC0KrlWxj/YFqGWVkQnQZCRnDfEUeEdXbPXpMfvhiGMa3shw5LtZG2ybRwtAHYcr+woEfX0h97M9WsannH3ghaW+k3TVdTO0iN2l1b3FfEA5m7MqjLWmwPWzExjBcoG403ycSupKAW8nbFgNyPrtmKykthbigbe3f2ZOrj8z0XqNFy+lgfUo3+9Fd6ZlPV/PSJcxz/D5bq5uiA4r6WIxw1v6enTMrOLs+6+VgyiVPWZj7MVvTae5lNbLGaJ81QdC1RWZLUo4cvovtZX/dPTAwAWJ0I4bEU0y6rngcmoFdMED2Qt413nstW5ELikluAkFalJ/Y1tb0VSsDR2tY8ekt+Rf7Uu+wEwbtrDDshzFukvQHTzZK2dwVrLghjYvHQy081X0T5BrFYqBbszJVklbMQTSNLcPOIo8g/t3L++iSVxt09QTfQrCeINajOxZw2J0ZW8/VJbBluYhA8vwlHBDxH7MZrlnE0RmtBcN9mq3oej5ba6MUms6XxUV903Rzp7/ItvMEEg+YNlM4XKuHpxrlbLI3dEir6sl3wbaS0wjC4I1urD7H5lit/rav/PcLOW7DOuT2IMFKulW6fBfnBAU4yjRJup/Zxvas4AEMswHBbXUswaULYTUIJgK46uQ/yF8z1ULl/vneta0YXZ+N9MPN6orwmBIF0juxiHbhc4u2SXdeNSA0dbFJDr8sP9V9xZnWMacjPmvZINyLXA03TZJs8f2f+cKla2JImgEvDsaB0W/cypRmwmvYSkSrnlm/HvX8mKkyXks353z4bFAP9kHfeKmTRG2aNQhdZdnffaEY/uDbvc6sBmFkp23dTJf5ZmEiKQrbxy7gidBLNzcaX31KtzK5EcPVn5zEixwJOsuN9F3MC7csXEdItKxoVEGnYMBqBHlYE1PbCPZgcLKknY3Sp7hxfLrps7uDHbW5DmkbXVKUegT/qAl3vuE5oUWjaZ2joHXR8QnJ7cGfhc/60AWb9AcyHEEbfEJyt/fRS9PFEDrK0mjugIoleTAiMMP5+viKlCQZxEK8rqKGm3I5n/8fzc1yDx0pEThTmnh3Mz0af0P4ln76W/+B2Wtg9MiNq/e7XNtLA13lnH4jByc5sGK3eU2c1WaTBNwVFAttfywWbIbuPrGU1Z/c/5l9rdP0d3ppO2pHU/qgGjFNkGHoTLCIGpZu0UKFN50bt383azJAG2Y7+7lrkdbq6uriWypkD02k4JaY3Uqa0yUpxhnsAk3C6M4zYN9hXy/TiyMRrjJRIXUQUySruaOXQmuF1rF9FZc+P/xU5BEiws5UTu2cWpFoOSydKYM3N4L0e6ZZHqTO2TIKReyoSF7nxVmHz7ZnZ2d3JxPG+tv0wYyzo1z7NdptVNoR37hR5VaWU9SfbNwG9ZNKcdfVw2ZpL+BExCRqzeCer44eWHsba60E0/PYe2wtQKbO0tMdI2KpCHuqKHqdyBaRhtRt8SrTrN4qsgFDRvQI04gpkjcBcZE/3ehcVLLi5JnYrp7DpedTzj7+Spe+d0XexsckxxXBCWuBv2Nwyrn48Xg/tLent58sQFeXAUI2aXbx6vZPrvTt1rDrV5sJbefprhNN28O5DH6cHlxlZgOLF2fYxz/O/gLFXyL/73Tk6Q/WXVsoyNXkahDOR3WkDVehyhYhN2hmbdiUNe0UYXeSZnIOXfiksFooEwgGHHMUmcv9L4LcqYU3/nh9I3m6xtUm2gOEDZ47mZkPWjxdHVFJkNtPOteSLs83yZu26vvpgu6UclFbarureYIcz8rUoggpjF53iBVZPdR1iYkf7TgtwWFvLZ0lU0ZtUq2o0LO009JbP3TxcXyY/WGJPAUME4gYES1aZvdpq7wirXU4Pyp1FB3BqczO5mRrujeY1s5lyUOrxkB3IVkYPZAkTDIYTL7bUfxPz12/JaklFvUkAiFBIQfn2JpW79TfcUVo7r8JYaqHQaLH9fxS5E50tXgwhhZQiQyZsmR3uvncj8O+WIgiqMkxoiEiU+T13r9+9waWSya5aGxZoNiH32AmbGVnmi5L9zvHH4Tkr46ijCAGxhZr12Kka84qZNoUtK5LnqCF2PXImc2Ms58rG3EJlCtJG8QidLiSb7kEKP777Bd5nCgShC49z7CLVE73zbV69q4V+qOTbOZGzSpCj5eObF8zNKwOu/sp9ApAtE6yR9jM7pJMKOy6hZnFl+tnG972J+laCZEt3eooTNvmJFz7e3WepiU4yNiet8zalqEn42rCAex2slodH6iNdzf0lHczoXmDlcuT9bd465oVrTszqssg3RrRgo869vVBKm2uVvOuCecKFvpbSHZtTAOo7GtSavEMq2RdrzYUx0x7zYhWZx9c3HYCwhNKp8ujSuKYMX76fHc4N4/SS4EDuPXyBEZNk30Wz7O3X/TcIXN25jlCkZgsxo0gUvm1mGHbo7e02OaxZlVHeHJychu7ZR6WAMcWRlF8rNhM6nPtjYRGlBnpuvX2VUdZTsoEvTSqUKyaZdteud/NFY4IpASQi6aQTpMy2xLUDnWw8VL4rqcetrh2CMlVUq5lDx6v1KdJX/7HDdNvywpbzxzSfpRJGmB+8u+bw9v+Cbp3OlUu6QKLvEEj+eL6D0zucIIwA57D2iSdY9uN0Q+lhEimm62UGnbeEyT9Ub6soaFVKf6hs1jwRxBoFJEIoS1LT7qJmIWjCznse9ivbF2FgOTGP9yEhAsSHJUfOxe5YMu/6tlSksQ/RigrZriru2JGLIJQ/DFSltnW7OCZ3d38rmBIAXStRAvltcuHb+Isr+tn6L/jbMPtw+mtXM/+oeNl2Qf2nVH78U1sMAMIjD2nRxzkgKz1rUROOwjj8v0FO2UnCHOYgS0sHdjF/pA5ocsuC4c72NeTo2V0rMMsAtSl7MPNPYRh9rZtPbRbJI9kc1Cf3n0GPvvFYihUPHqohhZ5lxsuPRyhHm+WSDTM6nY0AwdZIJZOWkcOvLbKcl2chfNQa8gD2SoVxUxqqfZfvpAj7LizxIPKeSHID5DoxiAHUu1aIWI9T3SvrrRBQEkoKloJ13WRD04mx4hkWzGIJFiTh2s9sz+fz2esIKCDWjVFJ7Nxi9PEy99vReGYy/zcCP19X0OgDLHLxHgi9blX9GfHVaVyfitwFhnLCBKVImFa/MPNa9gOViMwrTO3dJMRjbUz1YPsjzaQc+cEAf6j2+6aOsW1XJmmWk079fx0Z1Pie6hRsVVED+FWojx4vDr96olHHezgKPabu4ZFDmrfD1lzttbxb6iPpoJkiYFiLWv0vtcW/nawkQoPcs9KPYwPSR9RWftH2J64/mjPB1SmEW5FCGFLlBFbvPJno1MXt23K6fhw4c9TrhFbLaVuD6Hj5oKLEGEAnm0a2YX8y1nn+j6FVJ+OD0TAJ49xwfQMq19kzYgWBvS5kRjP9JTGs909BKm1S6H991L6FUASemTTT+/O0Im06RJgyOQWXad0T6hZvRX2exBEFBFy1DSm5mL0r8hSvDr1PzdSTQi4dHQbMVWY/0kTVnduqj5Knz/BSSG5PHPvog+9yLIJ+iGRiuk83sTBJr1+/0NsglxPbRMxCAJQq/iafOjtSWUJBNtNdJYi1sETli3y4zDHDtswgVyZwAx7adog24pxK+GSyffiF1WyWMOOKpuUlHa5LbMrJQKhUK6w8s1R1YecjjWM1cAZYRKIsAizoQNR6tg5gYmdTRQpOKGHMnxhYTyWlXQN+OwQVXCc5856D9TAHJ3VTpwUsVgMzSJC9DartkLsc8AZIDik/7VqjVbZHu9VGgKCVpzlmg7YMA1bbLnlT5c/IekMqYyr6VymLG7b1X33jA2FFlE/+xrI35FJdGG0Sk1ac4/VerqF7m7lZhdM+ZYT3p3nZEw6vGsetIEdcciTDcO1BUZ6SbVaqp7NjKSnWA5mdRnHTDLHthkR5tfIeEaj/QcvZu122BlwUVZBVsfVWR4yMFrdIkJr0n42cy3oEy99bTIKuiabu6sJNMaC8mVNMZjZ6Tex6X/M1t+PMwZ/H3kHnYQAqzkeg8ieIzcO/e25EtckhSiRjPDU/yr0Nll5Sh+pgXAYuS5SyyQ3y4XNoVWLogV2q26B55wcrZsG3uItK7UfwT0jq7ORNnDL95ZA6GFWKwN+8C5SGKKca9o67GXPDoKDg/SRa/KEYRRydU0Getp4sK8/BYCDaTjS6t3+RJ7r9AZPpGzV38DEZpY1QX0k5QvXphQGWAoRczeKzPHPTV28uBZhgG/BP+amSxvEkxlEcVzM+gVjJHlP9e87zWyVMzmQgTclMKdKKJ33BEV4ALcMo8RmmrqfPsuy9GEGgQrXvrXQX4vXTpIKT+/pdqVm8EEprxhnHc1Oyz5YJZNN9lBqVk8ywn2bb1/qh/c81J0hPIQ++I3R7PJ423e68QhEMJCmvqQiDb1z81OWIRIWgVGe9JrHieHpgzkpdCCf5MUk3VsenGRshy5pcP6E7VZ2gGp4TFSuYdMDemSloOu4QhamWKd3WOo2+crnPNajdEQP9xrd9Ql/8qIpLSfO7n4KJHFdwBwRo2d9KasTHbruFWxI+R3NRIgOerM4J5BJjANFIagOkkW6dGJemsm1zbjXBLYU4i3giDOB540IaFO1iO1+7Rts+rd9FQihG5jd1U9vaO7o3xMeQB+fjfeNAAuKvk1L1x/QW95oWTZ5fPKYzD+7rKPrs+2jXAsXffKeziV7kh2EqCzklUgd2ttb6ksZy1oWUvQIjUjyqlX/E+9FCtZha7zJUVtTOwJrZe9joS/P9ZIjYtgcWYbCroOdDjtJuMsCG8TwzDs02hecnrJYn566WBMvwMPQy1NIb5ETi3E7PQ67sx/Ixo1ovCXs4+yeZT8n8w4U6AHZeug0PrBhCSOvbBKvmKXtjeClv20i0NiZ5Z8l/5RkJWpwpQyMyAJnPj3AX3Yu8uxDrBa4+DqBYhql65qsChxBt0KKZOpqYZVzL311jg0vaQl8L7sQ3oCf2v/oci6zzz6SAWUVqX9LpJeeWLqu+P2TPEo3gjyem2tFtMLOiTzyRVyZPEhMCZlpoPqLTTWSSBnSeSM/YpaFOpzwc7fyBPkrgtwdlWl4zOvWFDc8ObCBvU1GFHINaKAmZ6I+c7Hi8T7rtUQ0ahKSQ3ZD9E55nSzraoiIkim66dKe81EB+I6/LcTSFR6YQSQekSySbn/jfX0CAy8ShgBdl8x7zYh6VjeyAmPqMD69Qd6QhUafGJxaIhJ2Uvf+6zkzCctdH1regds3PNJTIGNNYAXhUjDvnL8k7Z8GSv1qFMFv8uBF93If5ESorseFwDVzd59Hyd3OnlCgiMGzy+9sKaJUZB/G1EmhEgieImFkEaIv1Tfch2kDEr0+dAOFPyKrhMJdvkAHw+2+eq3nQEojIKtAQHJb2YoG0WdTRyvGL1JNuM/SOF5ogoxIw0q+e4R5Hay+q6KTqDyivfL17MrzxDjp1mcG+nHfSjcDaXZ7KXsePThdK0HV0nkiCXF5uTn2tpJNSwUoC92sPDe7ZfyaH9YOst9fPMxzdyODnBp3dVtUN1t+ZoPHHgTnos7hEI633u2dWDZFNFdKkpzwiKFU34bzqy2PHQdKNMiGCl5OL12j6nj3vWwLDfXoVL/4hVZwjJPenjS1uJgkmZYJMRZKiWRFR+g0tOL9z3/kKk+T/XxT90PBE9l/4B20Iy6aTCsjHVeFWSmBD0a6RXudlYs0FnHdcPEAX62HGYItmW8Z2Yb3/ZHufdSOF5nx8t3sqiV0zBWMMNZ0+gD5IaiixHsEFAOlnaQ7LmfZhCX1wHMg2kwzN+2ztRxIi2CCDO7Byt/ae/MkW7JE2fnf2fv1THX0fcbkxMHl7cq+z+WR2ICHodAkWehcTrCcy1iWa2mkz7flvBl7h933/ATdeMwEuzY/X1beZ5sIX8Ol5lE7+WgrBtFnuX5E2pO4IZxqFJoF+Mo63VVn3L92gXclzMIw5lBmVrSsApdbJJ9knaS2DgqduQ58SH75xWFvC4dZOuki0qBrn/Kz2YB1qaO4cz+h+Ahys5z3LWF9teXJ5QdHkctCrRltrESRrnQP3MGucpjzo+kCR2+XRGHQaLqZETDOkT15QDP7YcRZg+SAFIXNoeElX/zQ396K5ygtPZZR5ccfOX+K1R/ricLhgMrCIzW6u0eWi6848XAfHFZAhNX5g784j2xdxq4lVO0aMQVtlF+8+vO0xn2uDw3QAsSxu2ZaUhceq6uoNM1PJUdvRce71mCSzKClyMZebZAuyx9kN/hxh6BiR9gvWTEuIq4mAI1apkEuTN67TAdbBgopEIFbCj7w5osiWkeZv747KDOAxaqumpo74zXO80iXgUojQn/HFwOioVUhNvbjKooCdH5Ih8MgWgbPjBMUwLOfYTVNAydtFeGDTVXneHd2C1cHHBKEFRJai8ts7uh5XjLEtpcMPFXUCiOh9LfndeF8No7P7AZEdPSK0Tr7zvJKohMZOT3Agz7PlpnzOAveE2i4cV3N69h7PhKVIe9a0lkEQ7tk/u6rWoFacZae7XVhCXtHHmXHtxpWwgzUPNeVyvTUZeZmkj/6b0y3Pc4KPa/LdU0RPaZDhWZpuz5RZC4/RSIZFRaJqth8MQhFOtidWwTmfRqAg7znc4iGBw/nnhfp2pGYxjvGYoEZ/ODMeBnWzrwaKg81E+gCMmWysZlduRAaDs0hzJUwSONufbSjiSAGvW0jcJrJlpAeskDy89fLvWqKzf7DO1xDIpagooPrR84nxB3O4xr8LbCs8pfnRuJLWfyzA6d/WgUbBsJgSorq0mquIzQIrxNGXfDRe6e9pVMPe9jcw1Fturq1vW8+okQIiVsoki/oh5bOlTLwpWFndMt7AhOW1nZOXrfvE3tZ7RfvvKtK55t3WVGEflfH3F+TkisNBOnQDjZiw7Ig6cFFvvOCo/H08JHn4hGEzLmb6D1LqTyb1aof2AJe7Kvo5phfJFG7d3vVhSdoEKYwYhGCWdImzZUf6c2lh888gHEjht4F+rlymi3fueCxmUGtslTE1EOt4etsbdSX4U+66ujUzmo0mPmJKG++c2nZcjaxHl2XhZgu3T7fv60pQ0Qb0K/74F2lVMatL+lHEQpS4IHEx5CrezYt/u57NHfazAuaypYnXnBamusXZuu5jaYz0c3Cvk4oD+yPxLpgQtxgUhgdG7U1OdrXXxh8V+WXfeBmRF2uBDWLhdqzngUJWud8aSLFXaRhEeXNT11w7MH3evXd0fN1SR0+zTq/vXCtDj9rokofYXRhuXBHzyFgxV9+sTmpR1Nhd5RwUwLde4qL8mZ2ePtZo6Y3byGspfNXZBqWrzIbY/UEPExDE4mT14oiUsPuX3v+KGXYSWcAHjQhuaFSpUfOJy25pNCl76aMkALiyZrflAkI/35WkDGRx2zL7s+OLF2ncA97T0p7aIpg7C7d+veah49vemtLugSUWyKzsyWEE3Ye3ypsadu8WnM0Zpv0th0qSXSNcCOoxjcE+P/J3tK+0K/V8K7ItpgKMEPZYpZNBkfdZ+kCmi9XY+4rwZD0hYItj42A+A9hd9joLf/jzGY47GBZKqiMLuRXSIKuPUtpIFG1Ibe9osuHtR+EsLur0xrJp3qmX8nmkAl/24aC7i8gN49nRtjyPd9X0GkkWwLXx0JIyzAThImi/P7O8+K0ONvGTaRBTRRA2aO1xYouF3z26VrBErr22UClJuH5enPP0vf2JUXQQohR7UtbDS908Jvctl3Em0SJDS1WpcfmxkcKOESJBIbV77+ipQq8MNvCU3ALk7efvne/Y21W6OZkVAhFNMvx6TSZjlgrAGILRG2A0KK/01tQu5Nsdz9JgK3nudIPVTd5V12QaK1hackTQqNwgoODz5wRrTXssNRhJZAxIUIlG7effpBgX6tVyzwDQwXnCmVOug/OfYf9xIfvI2TqvJIe3lCbflC7tCCd21prIhQ3xNaKqKaO0yKfILfPBibi5z9Ka9h0H2FGFRS3W8nJpefEs3RfmSd0xTIa/1GZ1uzMow96VaWhfEq4yfPNhVjDrkmCWSABnp+zGE9C4LOjw+mze3aV0RAnXCOBzriJnXtbYRYosgE6yej9StY+Hrxub5jtskCTHUwcRG5Ul6EhYglaKyETYAEnt8i0QJaWOZNVCnnOu0n2IiIVIZeZpKHvuQsMx/vsSYS8DZ3Q54XvvVIrRFgBZhc+nxRWpjspe9MbAnxPD+mOqo6UW7qHOYb+edwyL6fT1RNsrNM/u0bZwVgWraAJddy/vQna5jHWKx628b6I0+i4vIXiB1la7uPOlVzFA3od8am3zcQ7lkKYY71lfZ6NCILZqNU8zoab1BW9trhakXY8ZvD0oaXl8e+8Wgb6AjdjlgJn2QsPPcSmOpmP7uXDSQJEQuN87ae2RD3kTHrjBjrAokIWeoOe9HAHuzuKckYQ9cuEVCoCh51rhxaVJKhIlJqVC/iYl+pzpzeqg9WSMJ12FI2dhPIH2YWR5YY6Q2uRGoHvJnnhvnPNy+6tpIy6yCCa4tPsY2Q9up2jjn/ZELvlVMUNmubRqIjaXBQCKTWxDy98VUVKKO4VLF0XrJNdu9m26fCyZrqzzLXLiop6Ulyi341GLe72rFnuhXfvvj6p2ToEPcKSs7R8ZMlYIRSMMg8UaPBsc49yjdeZISm3XPNq2p/SFecrCr2tqtuSYISyXnBZfLeUBqfK5eNJXTisMxX0E5W60woV5xCbDRhArERhqgbl6XtsX/omJQ1d0xbjIkbuKRpb4bSTSQJ4MSHF6hgqH2JCXMtuf0UFljLpstA8G11ya2W05lxQLaDzJzvYcUSXYV5jouccAxJnt5Wh+NFJLiY2bzFRsqU1zoczQaKZ1DhoIIPIEHkcoxNFL+wvMqY6Sx8NwAZgLMeOfsBfVpeeeIeeZ21x26J9NPL17tGJXP4Uu2VZocSgP/DiwGT1nBi5fPGfO8Jq2NWreTAKVMrMeLo5mPN2Vv8U2M2QFkMR/cjSNtrxBlFlKHQqorF7esxnGwbWZzPl6uDOaimDu4QpRgwkkcy3Nr3kIXadK6Lo1DHkQCBrV31ivJrRAqQzPIWTlZveXeCmUoWBwV0PVgfG+ybyZaFriBSejhovDp2127Xjd+ajUBLgYBR9M5suSGd57JZSOYPyuZg0zdIN57TaDLEautN1A4b2LqQazB0cm+uZBzoJhnAiBRSDo8V5OZm/9o4di9UNO2xbjzAjEBEpqlPNPEHvAw88FdVTZDhwTX+aDnl59ubO5c2/M+ZPJtGoCiapUp5vXtyp9GZmZdDmCLpD8shzzXs+Uw8kpUV+H0J43KzMLQm3htjX4VKQKwSrS2CB5W6yDBIIuX80gNdKhzVJySSyN7dUjB7y7rtRSwlJSM+d8PHWMK8KWGMZZO8AZT7NvOLQ1Kl872ZNtLyXsYNjn9jZPbvViMBfJL/yMPvAOc/zxJ+5gH4YAzWYS19IWIueeb2g3IyND0/e99FzdyHMXlSkzNBAzRdacqx3FfpmJYYnuLq+TTeCyP79mVJmcGquNrXEhTo7CyLwWWLm/Nom0eGgJTRTJ8m1lVzrjb0lN81YU9nHkbxWpFx3kGQ/FFp003O6wpAcJjRbotTngWYJWsk/mUeBj4pEDJMwc8lfqiLkqJeTOsWB6KD41PhIXdkJU/Nr6bQ1Qt8Y9oypk5mXWnIOLyPdrBlJTHopUkNx7/ZbQSsARAtXRpS/Pnwm+OqHw37HEV/PTmS1LbodGEUW56j0Hd/9yz6Xzj9aFRO72HMXorNYuKrneIJQTpHNmzmnu9JhV/TrIk9EH3hXhDBPDOBPLKSZYwb65h62b2psm7yXbZhZiL8udszDI+9+v84p0PPMb/9GfPk7+9lIehcBBRMFesI+ndBu6tk7bGRzwbavRtWRSFlbP7TYBTrCWZShJ3Q8T1kxPorZP836/Fdd59paLBDDs1Tv4vgfD+Nx2CzAUZ3z3arzPuRJW2YwfFBHO4VBN9DY2VIU6busO6HBueXKAz0zzIt7f3QAro7U00jAwRqMGPPi8bPCdSHmvXUbS2vmCWiFnu5zBzbPcztFENTmqaeuOLhy/9Bhj1SEnhEbpMJFt98ZOuffv9Qv9BhgqRvUjZRmPjBRJm+4mh8aOMLuXXiMIX+pomE/PLazDyXiAAbrm5hIcBk7heatoDke2UONZ1Y16bB0sLmkqe0MANdWny0WUComodailuoiN0pF+P4vtjApwWNVULopifiQLI+zxTlS7rr+pXFSHy6iOjhYCn4oHdWEFTQGGig/tWgjUQ/fSizS6WRpFBqB+Yw3IDJF5/O3Yn4laixA5Cj6di5Fkef4D9zKFYSalHW05xVr7lzuEYiOodfTsKpNustLGI61uhkkYIWWMvn4qzHDHX3SVdp57jI42nsNTS0ukXzmRpctZLIgeHIgfdR3zjsw6JmdSQyQQUi9kPOWN4hh1tA1ISiuxdGsdLZCRnjVWHgwyvVmklJZtMXNZ5cn4SWkuA4PuqZVKLbwKMNsO7ddC63cSpg9SwTqbn6au7rfG59bGTIRNAeQ84/jDAfC1JXTSvQ+xK480oJS8DTXClQU7Uhh09QVdLFuE7Sehuwy0JHZf2LpOMbkVfclLfQKQ7Z7153zuW9IJmQEvfl1//dXjrXCLIcckqlr9ICkCi+cw8DjeJMVnlTRY0LzaCDljKJk+EXosTE+KqOqN93Xmx2YXsa6jTTIQ9S5drpM+bHlT+j3Q/dOKEsHykhnRTc+mN7hb2rlk/UomzCMrudd1IELk4eC+KEbxadH6Xp/utYZbkFtvRsJKDpcNuifty0yBNx3BlI65h1Bvb6urtN87VIJoGgC8wg0WQSWENptJeoQ7/hhuoBzE8PzHJghhDuVzePz2IYBHG6ijm/V+Z6PtqYJ+ImnTv9giG1YO/J4eFxHoWxxM2MrJ8rdwbpRUqqtnYtgmnrHUXYu2Joj0AJ2CZTILHiFUGKGrc+7PLDzEbavCWdhHFAVoA2UZfevLjWjUd+b4dgWE76D7eZv6GhetOLONLgYpWV8lO695C36/oelMgHjhJEQmuihsKHWfDXLGjaT50YsgcPyX29dtNKnkx1HorzLiEhbRaMmSAMksonKxjRvHk3ZIEqjb2Ym1raA4J2jw2wXIBWJ6jE+CgKRzfP92m0h0xONkqUTPXvPq+XjbFKnrjdaCT761QWEXGTr0ZJRqqR0cXAme/kFGMQd91R1l0LsatAA8PuTn3mVRRxjf+1qvK7nEXCzi4waeVQmz7j5wVz9SX18Q+GO5TD5dnoMyKQBponxem8T97bqYBLdpsjeg41qINRCOiv++SzpWBd4ltTWp+YWIS8ZYuvpiEd0/5nSHY6uPNUKVWWc7SRrhiwwaZ4bP/zSaxjXHLapQo8qyK0bls6WmcJ15fx8QfvKpuFalWyh0vNe9k+tIORPsm3XZgDcUADFwcPxGZQhwzSmMLySy9I72fk7n0POhjKXtntMWamoqP9zMdjsHIF/hApAEECO7/6BOy4g0fOPNgLdAIPkS7v1e3/0qjzsSBIBRcPQgQMz1gXCGmEmJ9b2TAU/4DQRSOjQJb/QWTi34sb6vuWN+DA7TqfcjJDdTUi7t9hKNstjM2VuBuVwNz05kF5MI3SwDTeRvtJNsTjmKTpc/S1QSnlsZ6WMhiPdeSxF8jWEdGE2Dm5oKHvSMJGApUQWequ7S8XsbE8h//78LHi6/gKPsfmECv3ktRUFvhlkHgdr01MDT7uKADDtkAJDnOSVf2HLwaQ4254B5Q63keRaq7Hiv7KBKLJxFs8g+Y7o1iMro8p32Ey2AmYUGdDIkId49uMJhcJHryE3xLbMINsSA8+Eor+NPlWtdqKLshhu9mnkUL3M9VA102w0IScdzlduMi09P5KgUGH69/2WPtkNg6g/4xvJg6sv8TPrWN6O2i56LOFtEyaqvtA8Ry3qRcBrC5IGZX9WiR5/+DWp4yxqBbmG+koPwyUkkQ3PpLs3X0P/vPcObP+Ovc7YcLOXXRcPFSdZTnMDo1S0AJCb1e1haH0yUNBgVY4fjC8Lkjzn3orOW8JRVMksTt8Yy+q+cChXHJhjx57+9soyPWvYlyuI+4irYzG0v5sy671CnKrP0eGBCRejX2KEF74WQ5ZTWnJ+U2en3vwWtprluSK4ZcZMAhvisZFln6XHbtVTnuBbWWI3m2r10710kxFTmMOW/+NNzqL3dPDpA+9AnR4oB1J/Ho1m3sc6nRaUx/QojypTpMC+Y0fe9ppSrzhbq6dH6uplJDS5pnXm1SnCzXsBnZ1iMdTKkGcQHjAvK0H5cSw2Oridsbc/MC91qZel+yeiQnz1Q02Vh4e9Hvhu2A9DRQfBpuCzXuD31NfAOkCb5R5YMXX8VezbJLmIT6EuRiQyh07fk6P9m/TAhIqC6wsEMCAoB9gVn2PsijUtU0/m398HimzEwujX7HIv99hHkpgkJnTGwrrxyckWP6PP1mPCELj8drOjoSUsS87S6QSCkVaUl0dYC4/yKjYzaoGiMIGaO/vBy+de85lC7FrdbasIMYIGB164lZB9HyA3A3Cn9cldM9uuW5tH0tAkbVtjuwd2985CK2j8zqVS0dG1rLmx0VeytSjN1Hn5+S93BGdhBqQ1sYBiUWQqI8MrLXwgDxTOngH6DcsQn+1+BcN73nhlQpkpOpakNwgooCr5a6RzqjtXMPA6xKaSjbIeTxTUPW6ZWka2PDYe1UNnNJsWF/vXtljw6HtpwH80ouZ/f4k2JG/mb5JctyAgHuCKcuMzDzUtW2R0X/7HXl1LgADAexZ/wN8Sge6F8uXBUMnVVvcnWHwFhsZnI9XSL21Ld1JYosd7SlQ0SQU3LIJMrm0pMTvSrDVxOu6q6Hkb9BbzQbUPUohlS0aiLgp0+x6Y2rfSuJbD/n0BEVMjYBoqT5ym6iKHrgKuRxFBrQJ0GpnEiCEjXWLrPna09St5rJffr3MQEYlKD/nR7mUkxWNVwAeMEjPR/SQbY63NQoiz2+7XVVB0JPLjnelFpMth01N/OYjR3mZCaBp3ubpca7rTIDR2+aRX0nVRpB6zf/iN177QuZz1KEJk0WN0DatSVoQ2uWmLvrWAI62tVZePDY9nCBjZul8nVs4V7Pw8eZwayoFI0nJ/2dM8pb1zlFV1bkXYfOvpx+MTcBGGbtS3908MhFdaCeiz91UsRHSQFVT9M2f9w3/TgSzdascDdi0DvPcRzt9dbH28UoiFBzLIKoDXXZqKnsZySijOPke+Q5QwBcqnkfLpbnEOQJjdagUjOXmCj3cuyoU2N/IgaHVRtaHQPOkavNHKZfaEWN7SzUD2U/ctlt/04rfNcxD90eq7phtVDuCptVbP/pB1tuAVAgfRby88nNHtp8cSaBKRyZssjmwNt1UCFEefQTNDC9vfQBGh1EQn2SB37Hj/aUvQr6Ks+3MECr0VKq3/PICYjClAMCom2InTxgA1cildNL7a0lbcRPMRaI4Jhm5eySiJ//hsRvtIet4P4c3uvc5yLsbRUVfQpmPcAGpQjF62o6VLTjpruTgmAs93UYHx2dsyQlm2iumqHVQmDP6k1pK3PbxnUCSEQRLTt3P60UUf8i1b6IQ+1vfgwEzdQgUSlCNZocoUxsQ2dUpDOgF1+NoDL5TFaMpSUZ39A6WWjYa1GOFRm5zok2vvOdHC1oRCNzdcw7A1R7whXwqekEf+pq6qIw/lH3umV2gPv/+3f+NilIXu1hHJza9QHTje10mxiPu3viuDNmRkC1PCQNhU8eT3VtDlEWK/R7cftMXRuvUny8LlODusqfFJ6vVMYr51rEVnBWPJgoYDIco9i0fZ/3Qr56j1ETqtSxfsq7f06ega/dy0VqMK39iaGYl7i/zIX+yaGP9TRm5bZwXBB9A4K1IX5V7yGuLLjKD2Vq3q6KA3nds7QBIlUspK2Wi+iioZ3LWuQQatWHf4tGvS7Co6dXQBRjUjhAwqPEOs9pRrS2GZBhmKqr+y/LQXv3nQcDWdj5Ruobd+lqH7rtf9sVufvnNzunsLuA00D54wI3p+3ckVtNR2sJ0KjHuooSI5uZUNLfcI4uxyF9SbACeorsj3tnrNMJuFNcQVkzOLCkyIHSrLrX0YUMuthTnIPS2JVpxt24Lc82oyq6TnB71FDMgVuhzed4bXhaZLScw2cDXJAEnjgU/j3+PsiOOEXtuzHxpe8M/+aH21tCsvNmJMhkU4yNooRBRJAFvHsi2QFvUxdnmH0+IDGof/qmIChGq6wXSYPc6jdlSXN5K30P/kCg3iUXaKY7xCyjRl+b0T9VcVeP8Ffpue2ZVN5jPKMGN63pl0rdEvt+4ihtjB/qcnNE1Ngs5baXn6VYd5eV0hoLsbb7yetawr4/8znxBBQhgt8Ys+dqeW7nlHQWreH+RRudv4QNhp5chcM4rEnSW1Luq7ZVFrGl44jA7b9i6lkOHXDGAIcpa6swxJHrrm/9bhxMPDfohOuF8c8n2tZ73c7JP1grJVCpWqUkZ4xN1If0MfQwwc44q8wxS5YLUbWheC0N4cJrAQ2Ooy+cc6WYi86iT4yzG9wAC1SeH3V9R28UFWG0US0oWPXy70nCtZBDGLcfqUHezeu9NlF8qDDkiUS3vi9pXE/jek2TyMq1ZD37xlWZJRb8+mGzV9uR4DXJo+0vI1vTsLIuCq1IOpl/J1akPHRVClB15iIWdb+HQhtq/v17qgAVSolp25a/Ezc/rSX2CHyXZyldDIABWIZJFOzveOb/eu+cQzpzWEtyf4c3rghcEJgplRJYM6ZwTJ0dikDKFSUQtz7jgy3lFuv7CS0iqfvaBAFwVXAE348SNOLcndlK6z0pI/+OW/W4FoeW//fBUctHq6g3T57lcVdQQK2nE6GNvVj8sItFRxEdmyokE9Mzd/OINUrqGnDO9uBpK/zGOmJhflViZ9Vbhle5jDgAfdfYA8wzWLPiM/HGKbBVhZ4BRh9OLWWvOVJP+d3XVTFJ6QLgVWarlhed4YGWk4JyjTdbWLpLsDRbmv8Fhfbd9fvrTzhk03MHbN9YfvGannhetiPrGyXFQygZdEEYhHuzPiWjo1rQxlo6hnZ3wFvlUHe3D0MUvJCJi8S53xEPsRy1nR/3WSZJZ0AH1v07oVQS1WF5I2m1RDxBD5xpKpl5BTLyGvJD8a0C7JgZZtU4jdkD4VQSmRAsuSNE4Vb1/m5t7Z3Z2hH+c62uSWnmz588VZSddIBfObjPyJJQ7EJ500gKSF2jx4k0ajiR7JM+vLeTsgRyPxmO9dFkSTsv5SQ+hiGFAXYMLExqB/RqGwJinsZKlQfeEmXp4oK9e2g7CFawGKkGLcGLUI0YmoqbWeKc0Ivi36SwMrim06rP629eRSkKlV6nGdoHbuHeg5npZBg7CaXYk5dLxNmDmEgkf6pJZV/WR6qX7mNd+vghzKwGB2tF2YlZaH5HWw6VNJOnuEFiEqKIs8P3Wbz+byjf1WDBOJpEW6q7/nyy3qSse7NuB5VKSSE8aS58Fna/ujesSIUgmLnmn3A37ze/P5spBX64Yzq3Bvc8Fk73BVoQdfs19xXb1noTXhmIjaqMMgfGLLoIk+KnRlBSrd6DfMHlJyNfkBEhNI6ECQ4LmVnp0X0NF1RZacCpkQ9oGzdPVgVE+vkZldq1YgsT7rBRshYUmV0nw3vUuVUYdCl/fT5YVrugtE/7UNrGWt9Whe2paOc8D/5rzRGT+/pOy9pnOCRwK2ZUCu8rdbG+rhTLINFVAUwVARSv/KUqIVcmaOo9QS5S+knKOVO06Emn+KdQwipEskuFWtjTVzh8hKr8+WKjrcJqxUMKQWxajWAurRXd8EUkDqw8XVdoLLhHTBur3AxACyCVOPIxoc2InND62wETXEwt/aGlXo892yZwEBdXSwWyG19KFKIysQ2iEnrTWsdp90SfHA0kNH9lahacAxA0ZruZ5d1vL1wqxbLkS10OYv7798mXLdEIt/DPFVDDDQxcUl1hrR9B5W77ktg6oX9O7y5FJlPCFvsppRqH7iZgCWe5vPGofZwCAZMbSoJsQgGFCaEkgg7qlqv23bro1BhioqNdUcDhJokDSrn4nZKGRX7JRr6MEMMdCtk5eIYULAhVzkapCFt/oX0CzYweaDniJ5PfvkmZBEFI2zMtXduYLstOfUxrci8YKeeyNmVg6xJaycM7T+XdJFbp8EI0KCWNnQsQJinNDtFTSZGZq0gxyjnmU6vuMsu1Cub1tdkh7kPIu38DGdTSxdavTpLQhodJZC2D7rTCbQvwKMrExsWa35dAPJYHfA/mvz/l1Nk8pediUdrLuOk5KK0ok1NoJBDepVN5fqSUxBkThGIy30C6JAb4EaUYeBpZv8KmPDxfCFcatdNw6Sh2OGzQc7507sGWPeqn8tpOyEJFH/9cvs5hWpQlZSwWwXISLla5bSREPsboy+wAhqETQZlFY2MvyWCkw6OLRpFzBg5/yaYRLDPVCNa2Ooi7DMEfajVsz9QEP3AqFpKgZSKbkUx38Hm8qAqz3YTYDKwbkW4oROkTUE5nsCq2Vmms4KOrBhJ2dPlj6mojYS2AZ3McOB/sfMa+XGYpxXKyiis0w0GRsRjd6vRkzATQleOP4IW3XFBTKrhdiqCogSlIwKUX76fTBn8Z/mBaYikCJ96n3fXcm7jrFBO6DTIjXSeNRZ8lhe3luQPKDN03V5YmBFEdpHBnVpEMdcFnq/w8vAAxCNpwKohOSldFvKXL6V5YROtUVBOosiKXH9UlgrzAZVwOexUP3y1enpVkiI/BxHLXEEg8FyLbHM4DF+/n09o0kSFpkB7uUYb2WUk9meRj7fnWZf5bCUetyhFBhVQDosCpapZG7OuSgUtmNv6bN18avLTXWgijTXTLceBgW/YWYl1+hgh7LcSnBd+2+gCG7pN9lQNqXuuYqhcqo/vRLR8tjmfMCuIEUkJhJPn4d+PhDpo0mle1tBuiLdygdub+lyt3TrOimeAnsW7VnBX0pNEragYyu6IjFSCPDbut/WQvCBIGMd9K1GxHQVb5FE78pvTF7pTd533eG/uu5LxcPX/VVPTz394drhew8y9m9f/+JfXPHeJEgZwKaB8gyb7lLZCZKCd6c/zjZcc1HmUHSyBh6z7gWig8izbCi8rtvShaEJvjJSwNBz3+LChBOrZ6YsTVnmnGDdowK82gmMJeBbBnKtX81hxb7AFwLdfYTL2RuWlcXcTVFwUyK0ZYv10xtak+SpvKvPjWXomVtL92t3sDS3FaihdU2f5OVkT7jpieVseLqAOlhUdAi53tvW6oNZ7ELp9PqCKoyKDLeiNkKKq6MqoAVyZaE0ED6EycDsoqywh8HNvEvgwH/WNrbcTFu1GY2znFz6FYmWF5raEpC1QSEZssCWhgnDv/feFCJ0XfCL0TrZ+vV8tEIv8NxDDYlMbrl8iseeRVOOzeV/IV05P97ZUlxriGTZNDHbB/BJZM5DQ+ixvC1cm0wC8BaI4txe1mQikcx6r0xAmaM+w8zffEXrLpXjxOPhjsAS/HM615vrhYlUUQtDg+Ax2npyRYw0Sf+uH+ufi1+0WXI72GNKuG6XaWlhUtmbw6w+wYMOupXVT42xXto001axKFSuOJ9o+ewWpfm3rBTKDws1dqT1Cw6M5wMWK+y1Et+cWTZwXfxOhbCdAvcprerlrdXUTH6xFwT1KGw1eW5m7Hwa9TAqDYOyDq5pN3PNjqZxnO89FjTTYF7PfDq0AmXiD3ccYc6dk/dumC0VcHjBQmFbyA4jzaOpnCzBt1SrazHwbCZ88WYU4giWQHsAxgRdR7abDT/aY9muBcar/s2hdSuRVjCpoSjDtkAfd5758qEO9hlN5rI6aBnl5etXVNa6C53TAaGUNEo/WNp1PQMDvioNzOsFxuTVu1qoyfSHWD0DLskuHRXemj5fHVOI/ZBrAdbV6wlT3PRp1mxky2cvAmmZ3CVQIXa2PCzJ7wjqtUYmCn39ysX8qYDhV/yaRArUpiRW5CUUsjWtrvxVF3mGfZh1W3r4JcrYDVnefpXzz2szwgL5Vn917sgKYHWRZfVcT3htcG27l372ce+uCczbNiJdQkuH+bHhUKsn56rwdAXFRYYVVGCVPr+8ozEyyo3VyAEihtDTmvOweVQaGOHmCt4lo4PnjSp6Q3ldA6wHxgtX7Wqh9mHq7oLULcLSMNSuR5u7ycCehReqAO/d+dXeURDDRNEtS4ZEpEAfEwTEgVgys7lbdLwidJHlSqvs7UCzEYSgyFtqDExfxr4JWAe+tb4VBQNCoWfyHJQRaAeJ8eQX2NuXepdhJy30ZGaUSLiw/7d6LXc5/YiNawxvkp6XEcG/FF/GqIa8yTwhDMPSBFuWmg+Fm/9s6VOY7LNRRnSpsGEN+ucN7lw+6gb5WMS2lDz5/eaxjO95g8hUmLoWNttMQQc+SPGydcg3ekefPN6XtCxwjHJQi5hyI8h80PWERiPbksn+wbWwMhdfqhY+/B2FqEIs2wLvAu/uCD9wk2VpciC3O/vxldinMOvF/D8ys4oAYvdA53kiTP0Bf7CMRXTXU2MFh8O7c8LWffI4HuSU7l5OM8TZ193PbkSRAHoEzdERNtbkCQpdMVQBJZsNsogIGUVblQ+e1yCmkwds2l/EuMGXcmMLcy6dMJs39NRNeIjl9PIKj+z67V/UBj9drSTJ5AMNRvS0y2iUd0WB+0hppTKZasPdn/3ihm1sWzHELtXqYM/reXqAA3REPsbYg5gnrNNOo4XciqIP/qFZTeGph1Q8vfPZ2tjiEuqwmaSFMUcxkOhCGHOtlwKG2KDkCW7qoWrI+JSXi455bDsdnkQwCNm2yukfNF33HWbjGP8m9THU9IWEgs5TgxXadPi27H5Ls3kh36jyM85/bzb2wOrStMBQFhFuonxD/DxbsSo8NERG0Bso5+ezPaX9Lu1gzLWiFgyqDeSOwbwJK2q7KqrGPXb7Wm0Ih9glXE54U0koMn+gfCOZnvhKd9+N8Eoxqym5eWXN0/tGH5YxOmwxMrW8mhVLNRw47OgBAc4esFBhxHFPy6xLPttAe2wZMdACkmTZ0iif+s/ndadC7IayLsrXH9jmkY/VNiwTZj1LtrIxtGxAxyIpIuV5AzQhCPKsFSSGXBRn9DZbs0noZ1APe0HH1bvyuaWiZ74fvmzhoU1VNVm1Llwgtz+qXHIAXPqftKytLFQK8n6x9bG0/rROyGOXdnWwnzVQXGjCDJJTmjx5cgvmCWMg8+BbDq1ItFaBlchAHh3M3XL/9qX0SJiNQAkYsasNzczYOrjz2eYy13PJCapFNO+QO8u2nd8gpiVITBVm9GC4YsxsNBva6mC9GtRpAwyix/LM+UvMwqF0mZwapadcCcy4ahbYXcGuR5OklDz55DP/1yLq3AEeC+S688nxbPfuGwW8UC4eFjpooVIWWGa0UbDsgE92YGTXW1DtEwqvY5d+fZJdK6MKZIK2RHBvv67VMi0pkl9Zt5J8sceelUGnAUlNF3zPJXGC782MBqSPAt2pT3WuQGul6TKuCCa4gl1UVm5nyzy3Lw/qKfb2QuaffjWaM/2+t7af7AtCaORE82RPtraMXg+Rp2IFiUQdYW2wpnsvnMnePPLu+R+z11rs0ALDSHhz592z8/uVizmYYqNmX45GyQkEU0oKg8Q1tkGgJFO9/n2BL8Jer+XN5BU9L525IO0FllWJCKaY+PiK3i/OviJ1YJyk0+wyydwtCaEIT9iYMGSJYzFyjVXv3taD8dvLwYRf3S1G1mN2emrZPXsgi6oTG7SyLnft/on87qa62TewEpkVFyeHtvCFKmuimH8K7j9SPSaZJzvbShT6Tx6o9RQq17Cxc9xmZ4fvvZW+cXDk2z/+cr0/iWpDwlDkLpiIgqak2JgCi7Yee6wHfnGezA4c34kK+o6/ff0Ea4Hwl6dSph6FCW7VQI/wZ/0VlRiuwzSxoApI8C7y/5KdSxxtn22asF3X1N2wGiOMOK2qrRBZHOHqEQwE2roM973LRvRDk6xk6oQDanqlbTdY+oblUeVVew4hIKZsk4Oj1FWDxfCd3rKin4XGiJEs6lFQ+VbbaXdsO4s3NDTso5uDTqr36Mjzx5+QCuNrNRkuuP5dUsSaF003YBhk8G2bNPrsz7/yoQBXv55iFfisAxmhezkkig0Fbte2DHfwjpUyPvzsU1IXyoJcmRyT0RNLQKgwW0soGq5dxMA0OIu/0GLFJ/IuLJcRpjS6hG0jZtOzvP4pXpUVQdGVDZYsseXZJnKyocsYS+9XIhXV9DFSRJefRRzynB7QD+hCC1QOWfnf81rgDguhQOj0z/sL1UKfH+j0ni9k7s+PitTDQiYk0L5rax4NHoyccjFtAvEwcg93vU2bkiMdPnv9F5qfLF1uiNsTKbHaJXvYy8ZWKOSO15vB9C2ADAT9CrctcVLXsR6gEFP31KPiWZbTV61q9XJvZ+9NQmlxw7gakdrl3dowATRLz5QKOqjNLVPLflbvA+Ff1ZMCjPqugmPJ7a255TgxQt59EwsjX9FXRi8b7Ww18O04vl+8bGwMLYRrs+vTjS0y2e+C82Njyo7aaKKXXXqKPSkGU6J1l3T4w1G6yajKExhkj3xyHXuDlvPB6YYGmjrbA0osRNLLvcPOCrVWB/nNxzBPAE24gheW5lp8t2a5QvkyN+nqprm7JSLqYI31oNxbs5KQ7ovMf3fZCvuQN75foBROWkE///wNy77kjvTx9yhdqhWzzIBOWxxejm/J+9kvkUdFmR2abMhstVhNEgqf4QneMFMvc5Gk06MkaMk4JwwjUnpcHwyhntUjFnj3Lfqz/DeDPyHv8TL2hq4PVcRozz8IZDDB9gCyButB1rEy0XKuYL0m176JaZr0bk86SxnEcUW2kCdAYeQiZpssen/f2sX+mKUxRU7SU3UNzWG39dvNVAlsf+KxnuftYNaaFO+fYednYY6zXH9BT5Y0Lc3H+8usUNk7r1rOo7mlP4GTw+WfE+Ygx+1VY5DPL1brArA701mr1+t/M5rUBYhILHYRhHCj9kZb2L9OGW7KUiJKcNkGrgEBiCzPr//5z9dehyx1iIXeSMnqYGMDnQz6Xo/D0r3dYrzZOOJrsQzbicr4qKvFRSTevYRb1EE/Z0QiaFTiH41IyxAH2J4WewJDX+gDSNOtYroctzzQTEj/rYx1TyxUetFr89s7Wfg8L/ND12QI74tjkYDrzrXtF0crTRyyh0o6kitM1+3LVfsajzcxztvz40N+aEhrq2259Qf2Z/TQm4SpKZmDxD/IOlT0z2307WxE5bsSNooZCNSl+npz207fNntTrKnb39IDLwbU1WRY3G+tuETaCe+pIgRtB0F2q/zOxbGrz9Iu7xIJgP4ujKB/z196LSrKELt9IkMugxFDAA3BtHRz7v0Yq9sJMiNBJ1V+e9HZMzWz5E93sh7bBH4k00N+/v2NUr5n2+XLx3c9NjNOXpqUYkv6k83QDjjx8J7TIu6NhLMZ3XCHuU5WNBbcLWkm6D9ERY2o6NJUucE0zWRp/Xh29y5UzV559Pe2hUPOm0GuvE2Qo+lbjSBVIPlgbmrl77aJNQgPKDugCxVifp+zuL2oaUcS8SWQoP/ZO1fQmB9+6STGo0cSmqfFlOmmMmPfYNNlPUEReUTOM7k5kpNnhpdSXHvYuO2aJpinEFx2P/2Dpu+vM88JTr9HyxkduiVSXiEn7nf4Aa7y3jlZu6Y329uHfiAd8kzRH+QDIgCqK3TgxAsTsw+PuYiXJRL9jZ76yKHTmzkUZm+uFR/aRHB+P1hYxIOdF/JOV7L1iLMoTAKhrXNl9SOLWXzP+V4BaVvAT8wFK+9ewbVCbKyS0B0Qlh52lGsqor+KpbdaUbR/StPlMcEbUwcO1NhSieqQx57QbOqmnqTN7++dmWrO2kyy65KqdJA5a5Z4cy/uh1+RhNsOj7xQeNdWmQmqZgH9OckTUgBK2WBmsAjsuWT+okpPPk8pfqy/mk3reZdhks81vsPedMtnPUL11T/zZ/nR9/yPR4Yu7A4LdsrltGdGxNooVXlm0cfaiQJRwyBrplC0kCzVp1qvffgpqyOe78Ircl3R3ZRoeexPH0PuEcOmhETCdIKUQaEeXswr9obZdWsPnGbTB/myqDziNEv1z2on37dkUtr3tYvjHdy0IdeTzVYL/TdZYMFIaGpGQlCQMJubUeVGyQ+AysRgIWnZ0ZSrs1uZ7vc+o99px+uSF1zpurfe+yjzH3nmLY92XNgbhbz0+1WUI7CA3m91cvFZcp6zS0+fx0QxKfoLSqZXUI4/zG60dOITBbqZD8S9pkTrhqwh3BhYihS/2sRgUoMs5Cl2ZprDKs0v6A/5dEfOoLvQUhhE8a1dbLjZTHp8cXVFuio4Rft+Uesu5StJ5I40NZ8Ay48NlhUXrVwp6FaF2Bh5ECl0AwNUurppNpPvxW2s2rHKY2/2tTfUEWeMXbDDuoNdrx62ZQwxWM4L7LvhxaMPI4CoZhBPy7xLVL6+AvI2n40kJUIYhnl/93jTsum930RFPkYo6Qm7tpXZKuX1DJSVIaYhcLioo2zv/Fwf13zSUCQcjaGlmRaOgHeuiXI83+8I3pjtu3dnvj8jXMvC2XqYG5Z1NXoCJdk71wIBSJdSETMqTGVZrmZeUiqIBK5uZEd2fuX/RHxhL3vzL8+DTIW8Cz8CcW9fn/2wi/ZkrtytizcYrvNuq1iunnahBzdw+fSmlSSXVrGTMQO9ELLEWLPP2flBSRdwIrAG4jdhb8ltEVZ2c3WGAFIn+15699yHGKtlu3smME5ko04jcSWi0hhfwdFbeEXoNI/O2tnZwRMvvmMUWXzN+dHlClJTShcucLURcbA/1+mbmNEVE9EU0oIowMJ/Mt+T0ymxUNFjv2vLYwfn1hLuXQ3GbeP+9MzMa4s5fNbZ7/KIRBidiwT5a+7hFQXTPHb9qfQuySvbnOb5OkLT2VIpKKvHdFLTUFHyjCcm1OOgpL1jQnYlq7ncVs2FhtQO9EUM/VV233UrSdyHQsN+GJjLO9F5Yrwbb1xJWsK2bdPdmKKLH0uRVEURWSDrl0JfhK2kPnaaGRBhIfq6XCqN1x/XOr9j+M0SuHp9F1mUvRgr8TXpIhdRrrE9r/XpS5qNgNsxU/fWg4BhRUW1eqdr6x9qUed9qNavJxLr8WeusFOYjinLjZPzuw6s1hO2DFfR6cCELPTuAWplPvbN6VbzgPFw+LQXuHa8kS9nkmgxtTUzkWWneEKJlG0RThfRhwlmaco1Q7eCmpialuzLvMuQ5Uym0letz7G3A7isi3vsd3Z5m9iPpe4sB0+0md396uygwz7SZ1sG15OBAVy5SZ7kqhVdzN8BtM2cUEtqhE3XBgoLNfVAx6QcYso2lCtBEINcNwiDlNINgVyHwivrb/Zaib55odP4YsM19Xr9H5GuxoWslO5jtjDYnoQMehHkOaQZOQaXcPKauVi9uquL8y3pUuPQXHHqmk0PvJWBETf01g6H/S4vj40nUSQMNg2MrZOvIYnyPn4jwqoyFovImC48yfrrVv7Q/JbrkXCtTQVT17jGhO5sihFQJ8yMGd5QWoA3Uk+uQYKOB6GvZvWF07EgVenu7r8uTSRxBZHamHJJmIJeTwF6ZVJOYDsVMUzFMECkZmDuKIjBZWy17KvFHz9xRv9duY79bosVCygTAw5ITdAuwck/9CrZ20BPWxHMMelJAsMmbx97ne8ydCWrGVJZOgOhYrrGBvNxTcz+DEia9QhPbpI0lDajfXT5nQ2H42/37tmjxWquWJy7piBRF4kIJ/2mEE8AW6gKOFwReFng5Y6gaJAHQ5PL5K6OJisDtYNaSuPxlUyi++1cQ2wwmOUuIzGN02XmNXxI+yZs8qMjoEtCd43MfOd1P5KO89NT2W9ivLyBLu6PKjRxg2EFI9m1yjKhbEDKOvE/2QfP7yWEi+E1Zw3genTm+Wp/MpnPoINaua7N5UY7lYoSXLdTKqUihlDSikrLBi8lZn+gSELXCFhiYKQvd3unFk8n7Lfl6RydNFUqa7xiIrwQkfbo+16VPepgL1oxsgAxkNVgqGSVvQHYlFyAy0sZkdRxCHD96dEnrgjKQLrMgGCJZ3pHps9vcR3NnuWtYbWRe47/6kD15f53RMmMRnWcVQ8V1XPn7ahKSW36APIMCzTt0tQN+CiYEwkLpDY98DK0BlzXlqXXBnIOpvvREyc1TZSrMp+u+efwnDnsA9nsp2UkIqG66AmPhDvfgBuNh6aKt+1O9472g0adEDxoujgywymli/+EOuYmB29mSwm+41/pdwCBbS/l7iNP9f7I+5H1+6/y18KwU1GMJOE672/pOl5uyy7TBHso2ULTkq6CuY1a5DrEVNS23zHR961n7+0IeyiAbsvRomjLWZdHTMiSH0VPopBqJ7vsNcVzawlfoNIKo74+c98b6VFvSneXUe5K94PwuJ3SE3bypXSu0TtwzfQSHOXh4dMR5usGCaVtfPlGS2m6bHI2U1yCkj1qoyYyBj8ZCW7N98/17F1Xa0etwGAJY5/KD+Z7iw/8gDEWagvQ+WTritxgzyiqtFNKyoeFkd/uzUyfrZhC/8o+E9UB8WAY7YE7vfgbomHj4TD4s0cKSbGa9EujYLtb++r5TH73WRb+VWvsaHFoTN9u56n5RnbXhM5kIoyinT/N5KE017MRM1G4HunqitBHdaUOZghSimjfEMa7PlUpy3ypO/ftDy289ZXFeFt8zr9u+DjLVR9MgYUV3HOyrzRQOycD7X8xK7Sbj6B9hNtZNvxG3WsIVEB7v/5Xuc+kr93Q2Z2+7nJ2x3X4frgzPe0hkqRrgf0xMlShV0qyc6UD1QzUnNIVMMJN2RjIowNTHGOmuiKY9gjvALXHBDoVMjmmjdnbqjxYIbV4zwO16585fRu+57U1VjOr1vnvvQNwj8A9gKbE+sDkK45inK1FIMfV1gEtRdkVV01flHVuwccRxr6Bsgf/A0UWKoY/eFl4z/Arkn/P8435xw7kUNkBa6akgSJiO4pco+2ClQkoXYN3144aPCpjmm/VskmJq6TI5wYGXtr2+W0/fDvTTALFYriNrFpw7UPfvv37bBBgeKE9nA7uZm/sNGwJhbY9occJRIBrCfJX17yxBZLOqkn/7UPFkDfWEffRQEKCNRT32CNntNTUzdUbq/ONRqFAairGo8pA0TyhdYKLhPpNoTsLXDMYZk7mT+jyF2mlVm+plMv7uxvlfOnp7e/Mve20f8qu8Fn4k21N1fpmdeaSts7wxnRpVszITBx/n7fApud0sBKJViIWQfcDX8FssUtxy/jlrSO/z588fTvbcptz2zePPFnKkA8neEJTC0WlYWPmrYpa0paazIRro4fGNQMl8ab2MJP5fOFXpZy3oXNuA2N3fud0uHYoHArF421dtbL1VjZSBjO5GwP84BGO0PMvOz9CKHhoLBxnY6GdUo8Xt9DtxdPsDdVaju94k47nX/lKr/EP0uO760+UJlTUPqYsXQMRDTqIFLcV9BEao0FRrifzQj8LzWdF3p+Nmmdezn7iE3ecqfUZ8pGS+objt9XUhcdOi1WZslFsa6D9ZHXMjaqtE/XTFmaS1JbUlAi0D9l/e6O6UBxUJ3R4HWc81BvuSV+b23xqvi/gGuM8YKkiFcVtGD2FGR0CQ2ilZgaN6n5x3X2p58GpKKjDxDHXHXxyzzqvY09xyAtBWTuhtlBdtFXcndEzt6WMuAb54JpBt9CT3pm+jX2HedeSKdG8Zm6OOa+v0lrjOF54KBz2T1/2ob0sNz/fXZqvJJMGvyljYlRm6hghcEXungV2DsApVOopC2XF4I1CXaimYbEJfqHfROj6ed7/sexAPQeS5nb67xJ59UPs5+WKmRDSTKx2YzEZkxY69l3X2noy280w5khIw9p6HSsOrbuEp3pNaEFB7cDYLMdHau608vx31+U291YLhcKE1CMqPmshHo+CF9R9pngMPPFcE0CSkYvouueIYQYTr8m1vRoc3CgbJF/YdUVfJZ/dfPAvFnyV1w0h/u7J1lF2TRbmI6ZSQiQ+Cob+WMD/7Qqj953ZrRWeKVV3vvcEeUyTDqmu+EWLGDohkqA4KSe/8+OMDZN+Cgf1Fz+CUN37nHMifTKdTpeSurZTCF3bqUiiUmhMFgtfKf61Lg5rp3Q5IGYhdplKrIZFTCnMexZBryxGd26pVE6lw4ioO8WxseJQW7lcyhVnNWO1CMYBof7J7NKJH7KSKW5uNVSGS155v1z/xSLpkX/WsdShONmqSd8fGpr04/FXQK9zlhf3ytf4fwF6OyQ+q9A84vjnhND/33unvh189ZHc+sNTjG3obmx5/40ZTgAqo6etQjVFMFoXsQMYNYw2PWZxO8VxCGDtoiomUbwe/fMUIp9IFULYVhuEsR6b6KsMZgc6HzqkEw7h8Lo2qHo9QDKrZR+TPAkGcxDFS/DEow4KA91U0IUVVWq0f2upt9LXs377a5yBEx3D3h6/GO8Ije3o2HGl58ef81hHp//HnZPgNrgSIezwH3ScCZPH72Fszxh75C/qg9lZZ9/2XDa/pVIYzD22JY/+n+SW+/drijquaw24i/gmT2A4gh7PypFA1A6fjFnRQFXpGc2plJ5uozam0GAG7qGt+dLb6u9ZW7v5zqlfnPE024nl188okrIYyBUQE7I0cR18dmki7a9SrkBfHVhdg+wbfb9nd3awPp57fCZ37c/X3nf93eS8/9E+ep//Z6HAGbSceyfpzwcYm/vQhx74/H3fGQFnw3/6o4dqtd25J2/4Abvldsae79sKxqKJiVEQp1mo6oSMQKQIk6PRwpKrDWN1DAUtoCNRqaB4TDNYwrUQAVMb4iMpdG+BcyVf+Ztb8zxya2l+NpvNPXCWaiR761+K2RHtdZ7lo08gu7XceOopRK3BNyW4GQvYgvXE7RgGQUVtzOAGiR4mca9+135wd48mM4Xnv9o3sWtn+mP5Rik9d/ds37fvPt5XfW/uicc+fbJ3cHdpvtB30+hgfcutj/X3g7yzPL+rr78nV9Zk12TLQK+qgklaMGILU6fQ+mBI46NwAXEXsHgg0YeWIpfPoJ+UllaqZCNtu7T22s3XzednN3ke+8Th2umSh9CaIZ8sd8jz2rrqDVpDcXaIsPRtvUnhYnuP8ZiBVnfzo6ZpyAgYKk0BqrOASl6QiotBwaRov21UYtqZ1RBJdROpunwmGlUZNFLJd4Ah3RLRjSnbAtEUVKNCvTDBb0TMguEh0D4QZ0LeplBdhlyt6UeCYZAS9PXRX0eVlYpaWsToerYVxbx5XOJdg7ndj518xcAHA64dZ/LKI2GvvbNvgnUETpr3zE/S6xvuQpc7WabVQptH3fGHUnowRQWtd0rEYjHNJWnoGLcF3CxcS7kuuOGg+1z4cwrGysJINlJMmgJXkI8geVQYIJ0iY6cEmo4l2OxjkcjVaBYV7mqtqWCKXSQMAuYqodEfbizTly89MZtbm0vf/dYA8E0WV8WL8aKHXuArwu0KhTeVqxhiC0D7+lP5x+b7pW7UMg1oEyUiBnlotqZoJFhkY0JEYjVaESQqoKXucdGTqtG2hyYh3U/MAy4jJJIMXWsAtiJwUHKwlFjcNUwZQf6bvkPv0sX1FDNLEr4jLzVlpTBKRkukLOelLJdlfn62NJvLHT6Ly9kJj532Tt+kAtW2xXpzfHDe7d3H0qf6kmXD7DIQPhIQIhTfSN24iM5YU8a+1mVEYmjOMCJo3+cgVDS5nnqD2T4xM5h+QNAp0oVer0DAIIe6Gg8TAFHZCYcU4hf0V6BgXUU3wgPcmFIpchAzeZKo7hNs90DxuvQ7T7ul331reJUf9+PxttH7DVqrhrwrJ3/mfffQnx4aKRH4AsCCbVIEcPAFT5Hxi8XEAslil4F/BrbmvEuLmAjwE9yBhLZjXI9E0z+vMRVJVgpz7VMbYS0RKcBYQnDAZDZGlUoBSCULG6PJP+ut/eSaB77zFnamG+eh4kPbisV2Bvk3Nth1JrPmHQr35LrdwvG+IMSFoLdlk9SQd0hQydWV46TOgmC4bl0QgWSBNshaGHik+e4x+gESZmu8hJlHaIC29exggu35LaZINnr6s+OD0ih3r9/MRgZeoT/0fCcejl8Rbjt6vx3G0XEWwkDbb2HTm3P5rVvLhdV8taFlBxMtMQvU1NbNtnkGakkmpGaOVbrEQFiaopukaVQhbuWK/gyHn8h5JZvsm7/16VPVUqk713u8lv7ed0Zqf8km15I5vu7DdyMmQr86OkKhdgb5txZ8De8YYrou/vNT4d17exoZ3t8v+7+5pdSY6KugYb7cX842vjnfKMdWy3Jp8FS20vhcPdPfnav17jpVdvv3T/T3jAyUSoPd127fns6lG91rx3t/n10/d66mhI0jnNexA+ipY0cH63hr2+z91q9wnK354GWhwNUZaXzlp7VH8dUde4dzp9IvdW7CNKq53trd12/XAwQ2fZmxnx4MXlobeLaT3Ulf/POrER0GSj40ueehh3b4bx3bsWNNKLxjjc4uOlc81O6a+R1b69grjDOhc1zqVzjlPF15gyJoz/f909/21oXwM6E4yoJDno/6iTVndFJbObWXXv4hP3TaQyNN4/shXX/q7PDX+K94bqdrC/xVvtMO7LRXe7VXe7VXe7VXe7VXe7VXe7VXe7VXe7VXe7VXe7VXe7VXe/2WrnYeqL3aq73aq73aq73aq73aq73aq73aq73aq73aq73a68xqh0x/s9f/D8LdFMPpZpN0AAAAAElFTkSuQmCC';

    function isDataUrl(src) { return typeof src === 'string' && src.indexOf('data:') === 0; }
    function isRemoteSrc(src) { return typeof src === 'string' && /^https?:\/\//i.test(src); }

    // Pick the right embedded fallback for an image based on its URL/alt text.
    function embeddedImageFor(img) {
      const s = ((img.getAttribute('src') || '') + ' ' + (img.getAttribute('alt') || '')).toLowerCase();
      if (s.indexOf('signature') !== -1 || s.indexOf('sig-') !== -1) {
        return (s.indexOf('honey') !== -1) ? HONEY_SIGN_DATA_URL : DEEP_SIGN_DATA_URL;
      }
      if (s.indexOf('stamp') !== -1) return STAMP_DATA_URL;
      if (s.indexOf('logo') !== -1) return LOGO_DATA_URL;
      return '';
    }

    // Swap a broken remote image for its embedded base64 twin (used by the
    // onerror hook on index.html's <img class="sig-img"> elements).
    window.sigFallback = function (img) {
      try {
        if (!img || isDataUrl(img.getAttribute('src') || '')) return;
        const d = embeddedImageFor(img);
        if (d) img.src = d;
      } catch (e) { /* never break the page over a picture */ }
    };

    // Inline every sign/logo/stamp image of a cloned print document as a
    // base64 data-URL BEFORE html2canvas captures it. This guarantees the
    // signatures appear in the generated PDF even when the phone has no
    // network access at capture time or the image host is blocked.
    async function embedEmbeddedImages(root) {
      if (!root || typeof root.querySelectorAll !== 'function') return;
      const imgs = Array.from(root.querySelectorAll('img'));
      await Promise.all(imgs.map(async (img) => {
        const src = img.getAttribute('src') || '';
        if (isDataUrl(src)) return;                       // already embedded
        const data = embeddedImageFor(img);
        if (!data) return;                                // not a known asset
        // If the image failed to load, or it is still loading when the PDF is
        // being built (typical on slow phone connections), swap in the base64
        // copy so html2canvas ALWAYS captures real pixels — never a blank space.
        const broken = (typeof img.complete === 'boolean' && img.complete &&
                        img.naturalWidth === 0);
        const pending = !(img.complete && img.naturalWidth > 0);
        if (!broken && !pending) return;                  // loaded fine, keep crisp original
        if (broken) { img.src = data; return; }           // host blocked/offline → embedded twin
        try {
          if (isRemoteSrc(src)) {
            const res = await fetch(src, { mode: 'cors', cache: 'force-cache' });
            if (res.ok) {
              const blob = await res.blob();
              const url = await new Promise((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result);
                fr.onerror = reject;
                fr.readAsDataURL(blob);
              });
              img.src = url;                              // real pixels embedded
              return;
            }
          }
        } catch (e) { /* CORS/offline → drop to embedded fallback below */ }
        img.src = data;                                   // guaranteed visible in PDF/email
      }));
    }

    // ===== PRINT ALL DATA (preview mode) — MOBILE-SAFE VERSION =====
    // Fix for phones: iOS Safari and many Android browsers silently ignore
    // window.print() when it is called from inside a setTimeout (the user-gesture
    // context is lost). The old code deferred the call by 350ms, which is exactly
    // why the button did nothing on mobile. Now we:
    //   1. prepare the sheet with pure CSS (body.print-preview + @media print),
    //   2. call window.print() SYNCHRONOUSLY inside the tap handler,
    //   3. fall back to an invisible iframe print if the dialog never opens,
    //   4. offer "Download HTML" as a guaranteed last resort.
    //
    // NEW FIX FOR iPHONES: iOS Safari refuses to open window.print() at all
    // inside iframes / blob-URL tabs, so both the iframe route and the
    // "downloaded HTML file" previously did NOTHING on iPhone. On iOS we now
    // skip those dead ends entirely and go straight to the REAL PDF path
    // (jsPDF + html2canvas → blob → new tab → Share → Save to Files), which
    // always works in Safari/iPhone.
    let printRestoreTimer = null;
    // Remembers whether the most recent printAllData() tap actually opened the
    // native print dialog (iOS fires beforeprint/afterprint; blocked taps don't).
    let printDialogSeen = false;
    try {
      window.addEventListener('beforeprint', () => { printDialogSeen = true; });
      window.addEventListener('afterprint',  () => { printDialogSeen = true; });
    } catch (e) { /* very old browsers — ignore */ }

    function schedulePrintRestore() {
      clearTimeout(printRestoreTimer);
      printRestoreTimer = setTimeout(finishPrintUI, 8000);
    }

    function finishPrintUI() {
      clearTimeout(printRestoreTimer);
      document.body.classList.remove('print-preview');
      const overlay = document.getElementById('printFallback');
      if (overlay) overlay.remove();
    }

    function showPrintFallbackOverlay() {
      if (document.getElementById('printFallback')) return;
      const div = document.createElement('div');
      div.id = 'printFallback';
      div.innerHTML =
        '<div class="print-fallback-box">' +
          '<h3>&#128196; Print / Save as PDF</h3>' +
          '<p>Your browser blocked direct printing (common on phones). ' +
          'Choose one of these options:</p>' +
          '<button class="btn btn-danger" id="pfRetry"><i class="fas fa-print"></i> Try Printing Again</button>' +
          '<button class="btn btn-success" id="pfDownload"><i class="fas fa-download"></i> Download HTML File</button>' +
          '<p class="pf-hint">After downloading, open the file and use your browser menu \u2192 Print \u2192 Save as PDF.</p>' +
          '<button class="btn btn-primary" id="pfClose">Close</button>' +
        '</div>';
      document.body.appendChild(div);

      document.getElementById('pfRetry').onclick = () => {
        div.remove();
        try { window.print(); } catch (e) {}
        schedulePrintRestore();
        setTimeout(showPrintFallbackOverlay, 1200);
      };
      document.getElementById('pfDownload').onclick = downloadPrintHTML;
      document.getElementById('pfClose').onclick = () => {
        div.remove();
        document.body.classList.remove('print-preview');
      };
    }

    // Build a clean DOCUMENT clone of the whole log book: every tab panel
    // visible, buttons/nav/overlays stripped, input & select values frozen as
    // plain readable text. Shared by BOTH generators below so the HTML code
    // and the PDF can never drift apart.
    function buildCleanDocumentClone() {
      const clone = document.body.cloneNode(true);
      ['#passwordOverlay', '.email-modal', '#toast', '#syncBadgeWrap',
       '.bg-effect', '.mist-container', '.hearts-container', '.tab-nav',
       '#printFallback', '#pdfPreviewOverlay'].forEach(sel => {
        clone.querySelectorAll(sel).forEach(el => el.remove());
      });
      clone.querySelectorAll('.btn, .btn-group').forEach(el => el.remove());
      // Only keep the FIRST (header) logo — drop the duplicate login-screen one.
      clone.querySelectorAll('.brand-logo').forEach((el, i) => { if (i > 0) el.remove(); });
      clone.querySelectorAll('#mainApp').forEach(el => { el.style.display = 'block'; });
      clone.querySelectorAll('.tab-panel').forEach(p => p.classList.add('active'));

      clone.querySelectorAll('input, select, textarea').forEach(el => {
        let val = el.value || '';
        if (el.tagName === 'SELECT' && el.selectedIndex >= 0 && !val) {
          val = el.options[el.selectedIndex].textContent.trim();
        }
        const span = document.createElement('span');
        span.className = 'pv-val';
        span.textContent = val;
        el.replaceWith(span);
      });
      return clone;
    }

    // Collect all CSS that should travel with the exported document: the
    // inlined <style> blocks plus the linked css/style.css rules (flattened to
    // their screen form — the dark app theme is overridden afterwards). Without
    // this the downloaded / captured sheet renders unstyled on phones.
    function collectExportCss() {
      const styleText = Array.from(document.querySelectorAll('style'))
        .map(s => s.textContent).join('\n');
      let linkedCss = '';
      try {
        document.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
          try {
            Array.from(l.sheet.cssRules).forEach(r => { linkedCss += r.cssText + '\n'; });
          } catch (e) { /* cross-origin sheet (e.g. Font Awesome CDN) — skip */ }
        });
      } catch (e) { /* ignore */ }
      return linkedCss + '\n' + styleText;
    }

    // White-paper overrides applied on top of the app CSS for both outputs.
    const PAPER_OVERRIDES_CSS =
      '@media print{html,body{background:#fff!important}.log-container{background:#fff!important;color:#222!important;text-shadow:none!important}}' +
      'html,body{background:#fff!important;margin:0;padding:0}' +
      '.log-container{background:#fff!important;color:#222!important;text-shadow:none!important;max-width:100%!important;border:none!important;box-shadow:none!important}' +
      '.pv-val{border-bottom:1px solid #bbb;display:inline-block;min-width:60px}';

    // ===== HTML GENERATION (code only — for copying) =====
    // Produces the complete standalone HTML document string of the whole log
    // book (all tabs, same content/order as the PDF). It is ONLY placed into
    // the copy box — no preview rendering, no download needed.
    function buildPrintDocumentHTML() {
      const clone = buildCleanDocumentClone();
      // On phones the Drive-hosted signs/stamp often fail to load while the
      // print sheet renders (slow network / blocked host) — that is why the
      // printed PDF showed EMPTY signature spaces. Embed the real base64
      // pixels directly into the exported document so they ALWAYS print.
      try {
        clone.querySelectorAll('img').forEach(function (img) {
          var s = img.getAttribute('src') || '';
          if (s.indexOf('data:') === 0) return;           // already embedded
          var d = embeddedImageFor(img);
          if (d) img.setAttribute('src', d);
        });
      } catch (e) { /* never break export over a picture */ }
      return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Log Book \u2014 Print</title><style>' + collectExportCss() + '\n' +
        PAPER_OVERRIDES_CSS +
        '</style></head><body class="print-preview">' + clone.innerHTML + '</body></html>';
    }

    // Show the generated HTML code in the modal purely for copying.
    function generateHtmlCode() {
      try {
        const html = buildPrintDocumentHTML();
        const ta = document.getElementById('emailHTMLOutput');
        if (ta) ta.value = html;
        document.getElementById('emailModal').classList.add('active');
        showToast('📋 HTML code generated! Tap "Copy HTML" to copy it.');
      } catch (e) {
        console.error('generateHtmlCode failed:', e);
        showToast('⚠️ Could not generate the HTML code: ' + e.message);
      }
    }

    function downloadPrintHTML() {
      try {
        const html = buildPrintDocumentHTML();
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'log-book-print.html';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
        showToast('\u2B07\uFE0F Downloaded! Open it, then Print \u2192 Save as PDF.');
      } catch (e) {
        showToast('\u26A0\uFE0F Download failed: ' + e.message);
      }
    }

    // Fallback path: print through an offscreen iframe (some Android WebViews
    // allow this even when top-level window.print() is blocked).
    function printViaIframe() {
      try {
        const html = buildPrintDocumentHTML();
        const frame = document.createElement('iframe');
        frame.style.position = 'fixed';
        frame.style.right = '0';
        frame.style.bottom = '0';
        frame.style.width = '0';
        frame.style.height = '0';
        frame.style.border = '0';
        document.body.appendChild(frame);
        const doc = frame.contentWindow.document;
        doc.open();
        doc.write(html);
        doc.close();
        setTimeout(() => {
          try {
            frame.contentWindow.focus();
            frame.contentWindow.print();
          } catch (e) {
            console.warn('iframe print failed:', e);
          }
          setTimeout(() => { frame.remove(); }, 2000);
        }, 400);
        return true;
      } catch (e) {
        console.warn('printViaIframe error:', e);
        return false;
      }
    }

    function printAllData() {
      // 0. iPHONE FIX: iOS Safari frequently does nothing at all with
      //    window.print() (and never allows printing from iframes / blob-URL
      //    tabs). So on iPhone/iPad we skip the dead ends and build a REAL
      //    PDF in-browser instead — jsPDF + html2canvas → PDF blob → new tab →
      //    Share → Save to Files. That flow always works on iOS.
      try {
        if (typeof isIOSDevice === 'function' && isIOSDevice()) {
          document.body.classList.add('print-preview');
          schedulePrintRestore();
          saveAsPdf();
          return;
        }
      } catch (e) { /* fall through to the normal print flow */ }

      // 1. Reveal the main app even if triggered pre-unlock.
      const mainApp = document.getElementById('mainApp');
      if (mainApp && mainApp.style.display === 'none') {
        mainApp.style.display = 'block';
      }

      // 2. Pure-CSS preparation: body.print-preview + the @media print rules in
      //    style.css show every tab panel and freeze background animations. No
      //    DOM mutation needed, so the print dialog cannot interrupt it.
      document.body.classList.add('print-preview');

      // 3. CRITICAL FIX FOR PHONES: synchronous print call keeps the tap
      //    gesture, so iOS Safari / Android Chrome actually open the dialog.
      let printOpened = false;
      printDialogSeen = false;   // reset the beforeprint/afterprint witness
      try {
        window.print();
        printOpened = true;
      } catch (e) {
        console.warn('window.print() threw:', e);
      }

      window.addEventListener('afterprint', finishPrintUI, { once: true });

      // 4. If the dialog never appeared (some mobile browsers block silent
      //    prints entirely), try the iframe route, then show manual fallback.
      setTimeout(() => {
        if (!printOpened || !printDialogSeen) {
          // The native dialog never opened → don't leave phone users stuck:
          // go straight to the guaranteed real-PDF generator.
          saveAsPdf();
        } else {
          // Safety restore in case 'afterprint' never fires on this browser.
          schedulePrintRestore();
        }
      }, 900);
    }

    // ===== REAL PDF: generate with jsPDF + html2canvas, preview & save =====
    // Why the old flow failed on iPhones:
    //   1. iOS Safari blocks window.print() unless it runs in the same tap
    //      gesture — deferred/async calls silently do nothing.
    //   2. The "Download HTML File" fallback produced a .html blob, which
    //      iOS Files/QuickLook cannot turn into a PDF — so users could never
    //      actually SAVE a PDF on the phone.
    // This new path builds a genuine PDF IN the browser (jsPDF), shows it in
    // an in-app preview modal first, and then offers real Save/Open-in-Files
    // buttons that work on iPhone, Android, Mac and Windows.
    const PDF_LIB_CANDIDATES = [
      'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
      'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
    ];
    const H2C_LIB_CANDIDATES = [
      'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
      'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
    ];

    function loadScriptOnce(url) {
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load ' + url));
        document.head.appendChild(s);
      });
    }

    async function loadWithFallbacks(candidates, check) {
      if (check()) return true;
      for (const url of candidates) {
        try { await loadScriptOnce(url); } catch (e) { /* try next mirror */ }
        if (check()) return true;
      }
      return false;
    }

    async function ensurePdfLibs() {
      const okPdf = await loadWithFallbacks(PDF_LIB_CANDIDATES,
        () => !!(window.jspdf && window.jspdf.jsPDF));
      const okCanvas = await loadWithFallbacks(H2C_LIB_CANDIDATES,
        () => typeof window.html2canvas === 'function');
      return okPdf && okCanvas;
    }

    // Wait until every logo / stamp / signature image is fully decoded so the
    // captured PDF never misses them (Google-Drive images load slowly).
    async function waitForImages(root) {
      const imgs = Array.from((root.body || root).querySelectorAll('img'));
      await Promise.all(imgs.map(img => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise(resolve => {
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, 8000);   // never hang forever on one broken image
        });
      }));
    }

    // Build the SAME standalone document (identical HTML string to the one the
    // "Generate HTML Code" button produces) inside an off-screen sandboxed
    // iframe, at fixed A4 width. Because both the HTML copy and the PDF come
    // from the exact same buildPrintDocumentHTML() output rendered by the same
    // engine, the PDF you get on the phone is pixel-for-pixel the same PDF you
    // get on the laptop.
    const PDF_SHEET_WIDTH_PX = 794;   // ≈ A4 @ 96dpi

    function buildPdfSheetElement() {
      return new Promise((resolve, reject) => {
        const html = buildPrintDocumentHTML();
        const holder = document.createElement('div');
        holder.setAttribute('aria-hidden', 'true');
        holder.style.cssText =
          'position:fixed;left:-100000px;top:0;width:' + PDF_SHEET_WIDTH_PX + 'px;' +
          'height:1200px;background:#ffffff;color:#222;z-index:-1;overflow:visible;';

        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-same-origin');
        frame.style.cssText = 'width:100%;height:100%;border:0;background:#fff;display:block;';
        holder.appendChild(frame);
        document.body.appendChild(holder);

        let settled = false;
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          clearTimeout(guard);
          try {
            const doc = frame.contentWindow && frame.contentWindow.document;
            if (!doc) throw new Error('no iframe document');
            // Force full layout so html2canvas captures the entire height.
            const h = Math.max(
              doc.body ? doc.body.scrollHeight : 0,
              doc.documentElement ? doc.documentElement.scrollHeight : 0
            );
            holder.style.height = (h || 1200) + 'px';
            frame.style.height = (h || 1200) + 'px';
            void holder.offsetHeight;
          } catch (e) { /* fall through with whatever we have */ }
          ok ? resolve({ holder, frame }) : reject(new Error('iframe render failed'));
        };
        const guard = setTimeout(() => finish(true), 6000);  // never hang forever

        frame.onload = () => {
          // Give Drive-hosted images a moment; waitForImages below does the rest.
          setTimeout(() => finish(true), 300);
        };
        frame.onerror = () => finish(false);

        try {
          const doc = frame.contentWindow.document;
          doc.open();
          doc.write(html);
          doc.close();
        } catch (e) {
          clearTimeout(guard);
          holder.remove();
          reject(e);
        }
      });
    }

    let pdfBusy = false;
    async function generatePdfBlob() {
      if (pdfBusy) return null;
      if (!(await ensurePdfLibs())) {
        showToast('⚠️ PDF library unavailable offline — using Print instead');
        printAllData();
        return null;
      }
      pdfBusy = true;
      showToast('📄 Generating PDF… this takes a few seconds');
      let sheet = null;
      try {
        sheet = await buildPdfSheetElement();
        // Wait for every logo / stamp / signature image INSIDE the iframe too.
        await waitForImages(document);
        try {
          const fdoc = sheet.frame.contentWindow.document;
          await waitForImages(fdoc);
          // CRITICAL PHONE FIX: html2canvas can never rasterise remote
          // Google-Drive images inside a sandboxed cross-origin iframe — the
          // canvas comes out TAINTED and the generated PDF is completely
          // BLANK on phones. Convert every logo / stamp / signature to an
          // embedded base64 data-URL first: data-URLs are same-origin, so the
          // capture always succeeds and every sign & stamp appears.
          await embedEmbeddedImages(fdoc);
          await waitForImages(fdoc);
        } catch (e) { /* ignore */ }

        const canvas = await window.html2canvas(sheet.holder, {
          scale: 2,                 // crisp text on phones & laptops
          backgroundColor: '#ffffff',
          useCORS: true,            // needed for the Google-hosted logo/signatures
          allowTaint: false,
          logging: false,
          windowWidth: PDF_SHEET_WIDTH_PX,
          width: PDF_SHEET_WIDTH_PX
        });

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageWmm = 210, pageHmm = 297;
        const imgWmm = pageWmm;

        const tmp = document.createElement('canvas');
        const pxPerMm = canvas.width / pageWmm;
        const sliceHpx = Math.floor(pageHmm * pxPerMm);
        let yPx = 0, pageIdx = 0;
        lastPdfPageDataUrls = [];   // fresh page images for the preview modal
        while (yPx < canvas.height) {
          const h = Math.min(sliceHpx, canvas.height - yPx);
          tmp.width = canvas.width;
          tmp.height = h;
          tmp.getContext('2d').drawImage(canvas, 0, yPx, canvas.width, h,
                                         0, 0, canvas.width, h);
          const dataUrl = tmp.toDataURL('image/jpeg', 0.92);
          if (pageIdx < 4) lastPdfPageDataUrls.push(dataUrl);  // keep first pages
          if (pageIdx > 0) pdf.addPage();
          pdf.addImage(dataUrl, 'JPEG', 0, 0, imgWmm, h / pxPerMm);
          yPx += h;
          pageIdx++;
        }
        return pdf.output('blob');   // REAL application/pdf Blob
      } catch (e) {
        console.error('generatePdfBlob failed:', e);
        showToast('⚠️ Could not build the PDF here — opening Print instead');
        printAllData();
        return null;
      } finally {
        if (sheet && sheet.holder) sheet.holder.remove();
        pdfBusy = false;
      }
    }

    function isIOSDevice() {
      const ua = navigator.userAgent || '';
      const iOS = /iPad|iPhone|iPod/.test(ua);
      const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
      return iOS || iPadOS;
    }

    function isSafariBrowser() {
      const ua = navigator.userAgent || '';
      return /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
    }

    // Does this browser support "Save to Files" via the File System Access API?
    function canUseNativePicker() {
      return typeof window.showSaveFilePicker === 'function' &&
             !!window.isSecureContext;
    }

    // Classic anchor download — works on desktop Chrome/Firefox/Edge AND on
    // Safari (the PDF opens in a new tab where the Share button → "Save to
    // Files" / Print → "Save as PDF" becomes available on iPhone).
    function downloadBlobViaAnchor(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); }, 1000);
      // keep the object URL alive a bit longer for iOS QuickLook handoff
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return url;
    }

    // Native "Save to Files…" picker (Chrome/Edge desktop & Android).
    async function nativeSaveBlob(blob, filename) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        showToast('✅ Saved!');
        return true;
      } catch (err) {
        if (err && err.name === 'AbortError') return true;  // user cancelled
        console.warn('native save failed, falling back:', err);
        return false;
      }
    }

    // ===== PDF PREVIEW MODAL — iPhone-safe =====
    // Why the old preview "didn't work" on iPhone:
    //   1. The blob-URL <iframe> preview is silently blocked by iOS Safari, so
    //      users saw a blank box and assumed the whole button was broken.
    //   2. Anchor downloads of blob: URLs are also unreliable in Safari — the
    //      file either vanished or opened as an unnamed QuickLook page that
    //      many users never found the Share button on.
    // New flow (same on phone & laptop — same blob, same PDF bytes):
    //   - Show a real image preview built from the rendered pages (works in
    //     every browser, including iOS).
    //   - Desktop Chrome/Edge → native "Save as PDF" picker.
    //   - Other desktop browsers → normal file download.
    //   - iPhone/iPad → open the PDF in a new tab and show step-by-step
    //     Share → Save to Files instructions (this is the only reliable way
    //     iOS can persist a PDF), with Print → Save as PDF as the alternative.
    function openPdfPreviewModal(blob) {
      closePdfPreview();
      const url = URL.createObjectURL(blob);
      const filename = 'Soulmate-Log-Book.pdf';

      const overlay = document.createElement('div');
      overlay.id = 'pdfPreviewOverlay';
      overlay.innerHTML =
        '<div class="pdf-preview-box">' +
          '<h3><i class="fas fa-file-pdf"></i> PDF Ready — Preview</h3>' +
          '<div id="pdfPreviewPages" class="pdf-preview-pages">' +
            '<p class="pf-hint">Loading preview…</p>' +
          '</div>' +
          '<p class="pf-hint pdf-ios-hint" id="pdfHintLine"></p>' +
          '<div class="pdf-preview-actions">' +
            '<button class="btn btn-success" id="pdfSaveBtn"><i class="fas fa-save"></i> Save PDF</button>' +
            '<button class="btn btn-primary" id="pdfOpenBtn"><i class="fas fa-external-link-alt"></i> Open Full PDF</button>' +
            '<button class="btn btn-danger" id="pdfCloseBtn"><i class="fas fa-times"></i> Close</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      const hint = document.getElementById('pdfHintLine');
      const iOS = isIOSDevice();
      if (iOS) {
        hint.innerHTML =
          '<b>iPhone / iPad:</b> tap <b>Save PDF</b> (or <b>Open Full PDF</b>) → ' +
          'in the new page tap the <b>Share</b> button <i class="fas fa-share-square"></i> → ' +
          '<b>Save to Files</b>. Alternative: Share → <b>Print</b> → pinch the preview → <b>Share</b> → Save to Files.';
      } else {
        hint.textContent = 'Tap "Save PDF" to store Soulmate-Log-Book.pdf on this device. This is the exact same PDF on phone and laptop.';
      }

      // Build an IMAGE preview from the same blob — works on iOS where blob
      // iframes don't. Render each PDF page to a canvas via object URLs.
      renderPdfImagePreview(blob, url);

      document.getElementById('pdfSaveBtn').onclick = async () => {
        let ok = false;
        if (canUseNativePicker()) ok = await nativeSaveBlob(blob, filename);
        if (!ok) {
          if (iOS) {
            // On iOS the reliable path is opening the PDF in a new tab where
            // the system Share sheet (Save to Files / Print→PDF) is available.
            const w = window.open(url, '_blank');
            if (!w) { location.href = url; }   // popup blocked → navigate directly
            showToast('📱 Now tap Share → Save to Files (or Print → Save as PDF)');
          } else {
            downloadBlobViaAnchor(blob, filename);
            showToast('⬇️ PDF saved — check your Downloads folder');
          }
        }
      };
      document.getElementById('pdfOpenBtn').onclick = () => {
        const w = window.open(url, '_blank');
        if (!w) { location.href = url; }   // popup blocked → navigate directly
      };
      document.getElementById('pdfCloseBtn').onclick = () => {
        URL.revokeObjectURL(url);
        overlay.remove();
      };
    }

    // Image-based preview: draw the first few rendered pages of the document
    // into <img> tags inside the modal. Uses the already-drawn html2canvas
    // slices when available; falls back to the blob iframe on desktop.
    let lastPdfPageDataUrls = [];
    function renderPdfImagePreview(blob, blobUrl) {
      const box = document.getElementById('pdfPreviewPages');
      if (!box) return;
      if (lastPdfPageDataUrls.length) {
        box.innerHTML = '';
        lastPdfPageDataUrls.slice(0, 4).forEach((d, i) => {
          const img = document.createElement('img');
          img.src = d;
          img.alt = 'PDF page ' + (i + 1);
          img.className = 'pdf-page-img';
          box.appendChild(img);
        });
        if (lastPdfPageDataUrls.length > 4) {
          const more = document.createElement('p');
          more.className = 'pf-hint';
          more.textContent = '+' + (lastPdfPageDataUrls.length - 4) + ' more pages — tap "Open Full PDF"';
          box.appendChild(more);
        }
        return;
      }
      // No page images captured (shouldn't normally happen) — use iframe on
      // desktop; iOS users still have the working buttons below.
      if (!isIOSDevice()) {
        const frame = document.createElement('iframe');
        frame.title = 'PDF Preview';
        frame.src = blobUrl;
        box.appendChild(frame);
      } else {
        box.innerHTML = '<p class="pf-hint">Preview not available on this browser — use the buttons below; they open the exact same PDF.</p>';
      }
    }

    function closePdfPreview() {
      const old = document.getElementById('pdfPreviewOverlay');
      if (old) old.remove();
    }

    async function saveAsPdf() {
      const blob = await generatePdfBlob();
      if (!blob) return;
      openPdfPreviewModal(blob);
      showToast('✅ PDF ready! Tap "Save PDF".');
    }

    // "Save PDF (Preview)" used to be bound here, but it is now a clone of the
    // "Print / Save as PDF" button (see the print-button script in index.html):
    // all three buttons run printAllData() — which itself falls back to
    // saveAsPdf() on iPhones and whenever the native print dialog is blocked.
    // The old #savePdfBtn no longer exists, so this binder is a safe no-op.
    (function bindSavePdfButton() {
      const attach = () => {
        const btn = document.getElementById('savePdfBtn');
        if (btn && !btn.dataset.bound) {
          btn.dataset.bound = '1';
          btn.addEventListener('click', () => { saveAsPdf(); });
        }
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attach);
      } else {
        attach();
      }
    })();

    // ===== GENERATE HTML CODE (document format — code only, for copying) =====
    // NOTE: the *document* HTML (identical source of the PDF) is produced by
    // buildPrintDocumentHTML() / generateHtmlCode() above. This older email
    // builder is kept as a secondary option ("Email HTML").
    function generateEmailHTML() {
      const deep = document.getElementById('settingDeep')?.value || 'Deep';
      const honey = document.getElementById('settingHoney')?.value || 'Honey';
      const start = document.getElementById('settingStart')?.value || 'Jun 14, 2026';
      const end = document.getElementById('settingEnd')?.value || 'Jul 14, 2026';
      const scenes = document.getElementById('sceneBody').children.length;
      const honeyBonus = document.getElementById('finalHoneyBonus')?.value || '0';
      const deepBonus = document.getElementById('finalDeepBonus')?.value || '0';
      const safeWords = document.getElementById('finalSafeWords')?.value || 'None used';
      const favorite = document.getElementById('finalFavorite')?.value || 'Not specified';
      const lesson = document.getElementById('finalLesson')?.value || 'Not specified';

      // Build tables
      function getTableHTML(id, headers) {
        const tbody = document.getElementById(id);
        if (!tbody) return '';
        const rows = tbody.querySelectorAll('tr');
        if (rows.length === 0) return '';
        let html = `<table style="width:100%; border-collapse:collapse; font-size:14px; margin-bottom:16px; border:1px solid #ddd;">`;
        html += `<thead><tr style="background:#7a4a8a; color:#fff;">`;
        headers.forEach(h => html += `<th style="padding:10px 12px; text-align:left; border-bottom:2px solid #5a2a6a;">${h}</th>`);
        html += `</tr></thead><tbody>`;
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length === 0) return;
          html += `<tr>`;
          cells.forEach((cell) => {
            const input = cell.querySelector('input') || cell.querySelector('select');
            let val = input ? input.value : cell.textContent.trim();
            if (!val) val = '—';
            html += `<td style="padding:8px 12px; border-bottom:1px solid #eee; color:#222;">${val}</td>`;
          });
          html += `</tr>`;
        });
        html += `</tbody></table>`;
        return html;
      }

      const dailyHeaders = ['Date','Mood','Followed Rules?','If No, Explain','Favorite Moment','What I Want Tomorrow','How I Feel Now'];
      const domHeaders = ['Date','Mood','Led With Care?','Fulfilled Resp?','If No, Explain','Proud Of','Improve','Feelings'];
      const bonusHeaders = ['Date','Who Earned?','Why','Bonus Given','Received?','Notes'];
      const sceneHeaders = ['Date','Duration','Activities','Safe Word Used?','Rating','Aftercare?','Notes','Feelings'];
      const toyHeaders = ['Date','Toys Used','New Toy?','Toy Refused?','Notes','Feelings'];
      const debriefHeaders = ['Date','Favorite Moment','Uncomfortable?','Safe & Loved?','Want More','Want Less','Rating','Notes'];
      const weeklyHeaders = ['Week','Biggest Win','Challenge','Learned','Goal Next Week','Notes'];

      const dailyTable = getTableHTML('dailyBody', dailyHeaders);
      const domTable = getTableHTML('dominantBody', domHeaders);
      const bonusTable = getTableHTML('bonusBody', bonusHeaders);
      const sceneTable = getTableHTML('sceneBody', sceneHeaders);
      const toyTable = getTableHTML('toyBody', toyHeaders);
      const debriefTable = getTableHTML('debriefBody', debriefHeaders);
      const weeklyTable = getTableHTML('weeklyBody', weeklyHeaders);

      // Build email subject (shown in the copy modal header)
      const subject = `BDSM Contract Log Book - ${deep} & ${honey}`;
      const subjEl = document.getElementById('emailSubjectDisplay');
      if (subjEl) subjEl.textContent = 'Email version — Subject: ' + subject;

      // Build complete HTML email with subject line included
      // Sign-off date shown in the email — same "Date: DD/MM/YYYY" format as the PDF
      const soD = new Date();
      const signoffDate = 'Date: ' + String(soD.getDate()).padStart(2, '0') + '/' +
        String(soD.getMonth() + 1).padStart(2, '0') + '/' + soD.getFullYear();
      let emailHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${subject}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #faf5fc; padding: 30px; color: #1e1428; }
  .container { max-width: 900px; margin: 0 auto; background: #ffffff; border-radius: 24px; padding: 30px; box-shadow: 0 8px 30px rgba(0,0,0,0.08); }
  h1 { color: #6a3f7a; text-align: center; font-weight: 300; letter-spacing: 2px; border-bottom: 2px solid #e8d5f0; padding-bottom: 16px; }
  h2 { color: #5a2f6a; margin-top: 28px; border-bottom: 1px solid #e0d0e8; padding-bottom: 8px; }
  .summary { background: #f4eaf8; border-radius: 16px; padding: 16px 20px; margin: 16px 0; }
  .summary p { margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0 20px; font-size: 14px; border: 1px solid #ddd; }
  th { background: #7a4a8a; color: #fff; padding: 10px 12px; text-align: left; border-bottom: 2px solid #5a2a6a; }
  td { padding: 8px 12px; border-bottom: 1px solid #eee; color: #222; }
  .footer { text-align: center; margin-top: 30px; color: #888; font-size: 13px; border-top: 1px solid #e0d0e8; padding-top: 20px; }
  .signature { display: flex; justify-content: space-around; margin-top: 20px; flex-wrap: wrap; position: relative; z-index: 1; }
  .signature div { min-width: 200px; text-align: left; }
  .signature img.sig { display: block; min-height: 120px; max-height: 150px; width: auto; max-width: 420px; margin: 2px 0 -12px 2px; }  /* ENLARGED sign images (was 56px) so they are visible in the PDF */
  /* SIGN-OFF SECTION — same format as the PDF/app: enlarged 400x179 love stamp
     watermark sitting BEHIND the sign-off text, nudged slightly right, soft ink
     (opacity 0.35, no glow), with the enlarged signatures on top of it. */
  .signoff-section { position: relative; text-align: center; overflow: hidden; }
  /* PDF-style watermark — ALSO set as INLINE styles on the <img>, because most
     email clients strip <style> blocks; the class covers browser viewing. */
  .stamp-watermark { display: block; position: absolute; left: calc(79% + 28px); top: 50%;
    transform: translate(-50%, -50%) rotate(-4deg); width: 400px; height: 179px; object-fit: contain;
    opacity: 0.35; z-index: 0; pointer-events: none; margin: 0; border: none; background: transparent; }
  .signature-heading { position: relative; z-index: 1; }
  /* PDF-style sign-off dates: show today's date on the dotted line, same as the app/PDF */
  .sig-date { color: #999; white-space: nowrap; }
  @media print { .signoff-section { overflow: visible !important; } }
  .subject-line { background: #f0e6f5; padding: 10px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; color: #4a2a5a; border-left: 4px solid #7a4a8a; }
  .subject-line strong { color: #5a2a6a; }
</style>
</head>
<body>
<div class="container">
  <div class="subject-line">
    <strong>📧 Subject:</strong> ${subject}
  </div>
  
  <img src="${LOGO_DATA_URL}" alt="Soulmate Logo" style="display:block; margin:0 auto 12px auto; width:180px; height:180px; object-fit:contain; border-radius:50%; background:#f7eef9; padding:8px; border:1px solid #d8b8e0;">
  <h1>❤️ ${deep.toUpperCase()} & ${honey.toUpperCase()} ❤️</h1>
  <p style="text-align:center; color:#7a6a82; font-size:16px; letter-spacing:2px;">BDSM Contract Log Book</p>

  <div class="summary">
    <h2 style="margin-top:0; border-bottom:none; padding-bottom:0;">📊 Summary</h2>
    <p><strong>Contract Period:</strong> ${start} — ${end}</p>
    <p><strong>Total Scenes:</strong> ${scenes}</p>
    <p><strong>Bonuses Earned (${honey}):</strong> ${honeyBonus}</p>
    <p><strong>Bonuses Earned (${deep}):</strong> ${deepBonus}</p>
    <p><strong>Safe Words Used:</strong> ${safeWords}</p>
    <p><strong>Favorite Scene:</strong> ${favorite}</p>
    <p><strong>Biggest Lesson:</strong> ${lesson}</p>
  </div>

  ${dailyTable ? `<h2>📋 Daily Submission Log</h2>${dailyTable}` : ''}
  ${domTable ? `<h2>👑 Dominant Journal</h2>${domTable}` : ''}
  ${bonusTable ? `<h2>⭐ Bonus Tracker</h2>${bonusTable}` : ''}
  ${sceneTable ? `<h2>🔥 Scene Summary</h2>${sceneTable}` : ''}
  ${toyTable ? `<h2>⚙️ Toy Usage Log</h2>${toyTable}` : ''}
  ${debriefTable ? `<h2>💬 Debrief Summary</h2>${debriefTable}` : ''}
  ${weeklyTable ? `<h2>📅 Weekly Reflection</h2>${weeklyTable}` : ''}

  <div class="signoff-section" style="margin-top:30px; border-top:2px solid #e8d5f0; padding-top:20px; position:relative; text-align:center; overflow:hidden;">
    <h2 class="signature-heading" style="position:relative; z-index:1;">✍️ Sign‑off</h2>
    <img class="stamp-watermark" src="${STAMP_DATA_URL}" alt="Love Stamp" width="400" height="179" style="display:block; position:absolute; left:calc(79% + 28px); top:50%; transform:translate(-50%,-50%) rotate(-4deg); width:400px; max-width:400px; height:179px; object-fit:contain; opacity:0.35; z-index:0; margin:0; border:none;">
    <div class="signature" style="position:relative; z-index:1;">
      <div class="sig-block"><strong class="sig-label">${deep}'s Signature:</strong><img class="sig sig-img" src="${DEEP_SIGN_DATA_URL}" alt="${deep}'s Signature" style="display:block; min-height:120px; max-height:150px; width:auto; max-width:420px; margin:2px 0 -12px 2px;"><span class="sig-line" style="color:#999;">_________________</span>&nbsp;&nbsp;<span class="sig-date" style="color:#999;">${signoffDate}</span></div>
      <div class="sig-block"><strong class="sig-label">${honey}'s Signature:</strong><img class="sig sig-img" src="${HONEY_SIGN_DATA_URL}" alt="${honey}'s Signature" style="display:block; min-height:120px; max-height:150px; width:auto; max-width:420px; margin:2px 0 -12px 2px;"><span class="sig-line" style="color:#999;">_________________</span>&nbsp;&nbsp;<span class="sig-date" style="color:#999;">${signoffDate}</span></div>
    </div>
  </div>

  <div class="footer">
    <i>❤️ Created with love by ${deep} & ${honey} ❤️</i>
  </div>
</div>
</body>
</html>`;

      document.getElementById('emailHTMLOutput').value = emailHTML;
      document.getElementById('emailModal').classList.add('active');
      showToast('📧 Email HTML generated! Tap "Copy HTML" to copy it.');
    }

    function copyEmailHTML() {
      const textarea = document.getElementById('emailHTMLOutput');
      if (!textarea || !textarea.value) {
        showToast('⚠️ Nothing to copy yet — generate the HTML first');
        return;
      }
      textarea.focus();
      textarea.select();
      // iOS Safari needs select()+execCommand inside the tap gesture.
      const done = () => showToast('📋 HTML copied to clipboard!');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textarea.value).then(done).catch(() => {
          try { document.execCommand('copy'); } catch (e) {}
          done();
        });
      } else {
        try { document.execCommand('copy'); } catch (e) {}
        done();
      }
    }

    function closeEmailModal() {
      document.getElementById('emailModal').classList.remove('active');
    }

    // ===== EMAIL PDF (original) =====
    function emailPDF() {
      const deep = document.getElementById('settingDeep')?.value || 'Deep';
      const honey = document.getElementById('settingHoney')?.value || 'Honey';
      const scenes = document.getElementById('sceneBody').children.length;
      const honeyBonus = document.getElementById('finalHoneyBonus')?.value || '0';
      const deepBonus = document.getElementById('finalDeepBonus')?.value || '0';
      const safeWords = document.getElementById('finalSafeWords')?.value || 'None used';
      const favorite = document.getElementById('finalFavorite')?.value || 'Not specified';
      const lesson = document.getElementById('finalLesson')?.value || 'Not specified';
      
      const subject = encodeURIComponent(`BDSM Contract Log Book - ${deep} & ${honey}`);
      const body = encodeURIComponent(
        `Dear ${deep} & ${honey},\n\n` +
        `Here is the BDSM Contract Log Book with all data.\n\n` +
        `📊 IMPORTANT SUMMARY:\n` +
        `• Total Scenes: ${scenes}\n` +
        `• Bonuses Earned (${honey}): ${honeyBonus}\n` +
        `• Bonuses Earned (${deep}): ${deepBonus}\n` +
        `• Safe Words Used: ${safeWords}\n` +
        `• Favorite Scene: ${favorite}\n` +
        `• Biggest Lesson: ${lesson}\n\n` +
        `Please find the complete log attached as PDF.\n\n` +
        `With love,\n${deep} & ${honey}`
      );
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
      showToast('📧 Email opened with summary data!');
    }

        // ===== EXPOSE GLOBALS =====
    window.addRow = addRow;
    window.addFeedbackRow = addFeedbackRow;
    window.refreshFinal = refreshFinal;
    window.saveAllData = saveAllData;
    window.applySettings = applySettings;
    window.printAllData = printAllData;
    window.saveAsPdf = saveAsPdf;   // ⬅️ NEW: real in-browser PDF + preview
    window.emailPDF = emailPDF;
    window.generateHtmlCode = generateHtmlCode;   // ⬅️ HTML code only (for copying)
    window.generateEmailHTML = generateEmailHTML;
    window.copyEmailHTML = copyEmailHTML;
    window.closeEmailModal = closeEmailModal;
    window.showToast = showToast;
    window.forceSync = forceSync;  // ⬅️ NEW
    window.clearAllCloudData = clearAllCloudData;  // ⬅️ NEW: clear all cloud data
