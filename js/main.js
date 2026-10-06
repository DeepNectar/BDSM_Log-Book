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

        try {
          const data = {};
          SHEET_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) data[id] = el.innerHTML;
          });
          localStorage.setItem('bdsm_log_data', JSON.stringify(data));
        } catch (e) {}

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

    // ---- AUTO-SYNC: check for changes every 10s ----
    function startAutoSync() {
      setInterval(async () => {
        if (isSyncing || !supabaseClient || document.hidden) return;
        if (!document.getElementById('mainApp') ||
            document.getElementById('mainApp').style.display === 'none') return;

        const before = SHEET_IDS.map(id => {
          const el = document.getElementById(id);
          return el ? el.innerHTML : '';
        }).join('||');

        const pulled = await pullAllFromCloud();
        if (!pulled) return;

        const after = SHEET_IDS.map(id => pulled[id] || '').join('||');
        if (before !== after && Object.keys(pulled).length > 0) {
          SHEET_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el && pulled[id] !== undefined) {
              el.innerHTML = pulled[id];
            }
          });
          lastSyncTime = Date.now();
          setSyncStatus('online', 'synced');
          showToast('🔄 Updated from cloud');
        }
      }, 10000);
    }

    // ---- FORCE SYNC button ----
    async function forceSync() {
      showToast('🔄 Syncing...');
      const pulled = await pullAllFromCloud();
      if (pulled) {
        SHEET_IDS.forEach(id => {
          const el = document.getElementById(id);
          if (el && pulled[id] !== undefined) {
            el.innerHTML = pulled[id];
          }
        });
        lastSyncTime = Date.now();
        setSyncStatus('online', 'synced');
        showToast('☁️ Synced from cloud!');
      } else {
        setSyncStatus('offline', 'sync failed');
        showToast('⚠️ Sync failed');
      }
    }

    // ---- INIT CLOUD SYNC ----
    async function initCloudSync() {
      loadSavedData();

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
      setTimeout(loadSavedData, 200);
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
        showToast('✅ Row added!');
      }
    }

    function addFeedbackRow(targetId) {
      const d = new Date().toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
      const list = targetId.includes('dominant') ? LISTS.honeyFeedback : LISTS.feedbackPraise;
      document.getElementById(targetId).innerHTML += `<tr><td><input type="text" value="${d}"></td><td>${makeSelect(list)}</td></tr>`;
      showToast('✅ Feedback row added!');
    }

    // ===== SAVE DATA =====
    function saveAllData() {
      try {
        const tables = ['dailyBody','dailyFeedbackBody','dominantBody','dominantFeedbackBody','bonusBody','sceneBody','toyBody','debriefBody','weeklyBody'];
        const data = {};
        tables.forEach(id => {
          const el = document.getElementById(id);
          if (el) data[id] = el.innerHTML;
        });
        const finalBody = document.getElementById('finalBody');
        if (finalBody) data['finalBody'] = finalBody.innerHTML;
        const settingsBody = document.getElementById('settingsBody');
        if (settingsBody) data['settingsBody'] = settingsBody.innerHTML;
        localStorage.setItem('bdsm_log_data', JSON.stringify(data));
        showToast('💾 All data saved successfully!');
        
        // ⬅️ NEW: Also push to cloud (async, fire-and-forget)
        pushAllToCloud();
      } catch(e) {
        showToast('⚠️ Save error: ' + e.message);
      }
    }
    // ===== LOAD SAVED DATA =====
    function loadSavedData() {
      try {
        const raw = localStorage.getItem('bdsm_log_data');
        if (!raw) return;
        const data = JSON.parse(raw);
        const tables = ['dailyBody','dailyFeedbackBody','dominantBody','dominantFeedbackBody','bonusBody','sceneBody','toyBody','debriefBody','weeklyBody'];
        tables.forEach(id => {
          if (data[id]) {
            const el = document.getElementById(id);
            if (el) el.innerHTML = data[id];
          }
        });
        if (data['finalBody']) {
          const el = document.getElementById('finalBody');
          if (el) el.innerHTML = data['finalBody'];
        }
        if (data['settingsBody']) {
          const el = document.getElementById('settingsBody');
          if (el) el.innerHTML = data['settingsBody'];
        }
        showToast('📂 Saved data loaded');
      } catch(e) { /* ignore */ }
    }

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
    }

    // ===== PRINT ALL DATA =====
    function printAllData() {
      showToast('📄 Preparing print view...');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('active'));
      setTimeout(() => {
        window.print();
        setTimeout(() => {
          document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
          const activeTab = document.querySelector('.tab-nav button.active');
          if (activeTab) {
            document.getElementById('panel-' + activeTab.dataset.tab).classList.add('active');
          }
        }, 500);
      }, 300);
    }

    // ===== GENERATE EMAIL HTML =====
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

      // Build email subject
      const subject = `BDSM Contract Log Book - ${deep} & ${honey}`;
      document.getElementById('emailSubjectDisplay').textContent = subject;

      // Build complete HTML email with subject line included
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
  .signature { display: flex; justify-content: space-around; margin-top: 20px; flex-wrap: wrap; }
  .signature div { min-width: 200px; }
  .subject-line { background: #f0e6f5; padding: 10px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; color: #4a2a5a; border-left: 4px solid #7a4a8a; }
  .subject-line strong { color: #5a2a6a; }
</style>
</head>
<body>
<div class="container">
  <div class="subject-line">
    <strong>📧 Subject:</strong> ${subject}
  </div>
  
  <img src="https://lh3.googleusercontent.com/d/1eoI5L95RQxWzs0yaDrFMtst2FFsbK_Ny" alt="Soulmate Logo" style="display:block; margin:0 auto 12px auto; width:90px; height:90px; object-fit:contain; border-radius:50%; background:#f7eef9; padding:8px; border:1px solid #d8b8e0;">
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

  <div style="margin-top:30px; border-top:2px solid #e8d5f0; padding-top:20px;">
    <h2>✍️ Sign‑off</h2>
    <img src="https://raw.githubusercontent.com/DeepNectar/soulmate-log-book/main/assets/love-stamp.png" alt="Love Stamp" style="display:block; margin:0 auto 12px auto; width:80px; height:80px; object-fit:contain;">
    <div class="signature">
      <div><strong>${deep}'s Signature:</strong> _________________  Date: ________</div>
      <div><strong>${honey}'s Signature:</strong> _________________  Date: ________</div>
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
      showToast('📧 Email HTML generated!');
    }

    function copyEmailHTML() {
      const textarea = document.getElementById('emailHTMLOutput');
      textarea.select();
      navigator.clipboard.writeText(textarea.value).then(() => {
        showToast('📋 HTML copied to clipboard!');
      }).catch(() => {
        // fallback
        document.execCommand('copy');
        showToast('📋 HTML copied!');
      });
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
    window.emailPDF = emailPDF;
    window.generateEmailHTML = generateEmailHTML;
    window.copyEmailHTML = copyEmailHTML;
    window.closeEmailModal = closeEmailModal;
    window.showToast = showToast;
    window.forceSync = forceSync;  // ⬅️ NEW
