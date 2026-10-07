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
    const LOGO_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const STAMP_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const DEEP_SIGN_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const HONEY_SIGN_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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
  
  <img src="${isRemoteSrc(LOGO_DATA_URL) ? 'https://lh3.googleusercontent.com/d/1eoI5L95RQxWzs0yaDrFMtst2FFsbK_Ny' : LOGO_DATA_URL}" onerror="this.onerror=null;this.src='${LOGO_DATA_URL}';" alt="Soulmate Logo" style="display:block; margin:0 auto 12px auto; width:180px; height:180px; object-fit:contain; border-radius:50%; background:#f7eef9; padding:8px; border:1px solid #d8b8e0;">
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
    <img class="stamp-watermark" src="${isRemoteSrc(STAMP_DATA_URL) ? 'https://lh3.googleusercontent.com/d/1xT4SnUR8dtEHP14MUMFZnYZnumAS96Fw' : STAMP_DATA_URL}" onerror="this.onerror=null;this.src='${STAMP_DATA_URL}';" alt="Love Stamp" width="400" height="179" style="display:block; position:absolute; left:calc(79% + 28px); top:50%; transform:translate(-50%,-50%) rotate(-4deg); width:400px; max-width:400px; height:179px; object-fit:contain; opacity:0.35; z-index:0; margin:0; border:none;">
    <div class="signature" style="position:relative; z-index:1;">
      <div class="sig-block"><strong class="sig-label">${deep}'s Signature:</strong><img class="sig sig-img" src="${isRemoteSrc(DEEP_SIGN_DATA_URL) ? 'https://lh3.googleusercontent.com/d/1KnoE8uWAwugB0PRMiPmq32eCW-ZxMasj' : DEEP_SIGN_DATA_URL}" onerror="this.onerror=null;this.src='${DEEP_SIGN_DATA_URL}';" alt="${deep}'s Signature" style="display:block; min-height:120px; max-height:150px; width:auto; max-width:420px; margin:2px 0 -12px 2px;"><span class="sig-line" style="color:#999;">_________________</span>&nbsp;&nbsp;<span class="sig-date" style="color:#999;">${signoffDate}</span></div>
      <div class="sig-block"><strong class="sig-label">${honey}'s Signature:</strong><img class="sig sig-img" src="${isRemoteSrc(HONEY_SIGN_DATA_URL) ? 'https://lh3.googleusercontent.com/d/1HRoqjVvSDswlROnookv0ykGagHwLQ6FI' : HONEY_SIGN_DATA_URL}" onerror="this.onerror=null;this.src='${HONEY_SIGN_DATA_URL}';" alt="${honey}'s Signature" style="display:block; min-height:120px; max-height:150px; width:auto; max-width:420px; margin:2px 0 -12px 2px;"><span class="sig-line" style="color:#999;">_________________</span>&nbsp;&nbsp;<span class="sig-date" style="color:#999;">${signoffDate}</span></div>
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
