/* ================================================================
   DRIVEN BY PLANTS — app.js  v0.1.0
   Ravinto-opas | Kurkista.fi
   ================================================================ */

(function () {
  'use strict';

  /* ── CONFIG ───────────────────────────────────────────────────── */
  const CFG = (typeof DBP_CONFIG !== 'undefined') ? DBP_CONFIG : {};
  const PROXY_FINELI_SEARCH = CFG.fineliSearch || null;
  const PROXY_FINELI_FOOD   = CFG.fineliFood   || null;
  const PROXY_USDA          = CFG.usdaProxy    || null;
  const PROXY_USDA_DETAIL   = CFG.usdaDetail   || null;
  const USDA_KEY            = CFG.usdaKey      || null;

  /* ── NUTRIENT DEFINITIONS ─────────────────────────────────────── */

  // Macros — Fineli EUFDNAME codes (EuroFIR standard)
  const MACROS = [
    { code: 'ENERC',  label: 'Energia',        unit: 'kcal', decimals: 0 },
    { code: 'PROT',   label: 'Proteiini',       unit: 'g',    decimals: 1 },
    { code: 'FAT',    label: 'Rasva',           unit: 'g',    decimals: 1 },
    { code: 'CHOAVL', label: 'Hiilihydraatit',  unit: 'g',    decimals: 1 },
    { code: 'FIBT',   label: 'Kuitu',           unit: 'g',    decimals: 1 },
  ];

  // Key nutrients to track — rda = daily reference value (EFSA/WHO, adult)
  const KEY_NUTRIENTS = [
    { code: 'VITB12', label: 'B12-vitamiini', unit: 'µg',  rda: 2.4,  note: 'Lähes kokonaan puuttuu kasvikunnasta' },
    { code: 'FE',     label: 'Rauta',         unit: 'mg',  rda: 16,   note: 'Kasviperäinen rauta imeytyy heikommin kuin hemirauta' },
    { code: 'CA',     label: 'Kalsium',       unit: 'mg',  rda: 800,  note: null },
    { code: 'VITD',   label: 'D-vitamiini',   unit: 'µg',  rda: 10,   note: 'Ruoasta saatava D-vitamiini usein vähäistä' },
    { code: 'ZN',     label: 'Sinkki',        unit: 'mg',  rda: 9.4,  note: null },
    { code: 'FAPUN3', label: 'Omega-3',       unit: 'g',   rda: 1.6,  note: 'ALA – kasviperäinen omega-3' },
    { code: 'IDD',    label: 'Jodi',          unit: 'µg',  rda: 150,  note: 'Vähäistä useimmissa kasviksissa' },
    { code: 'SE',     label: 'Seleeni',       unit: 'µg',  rda: 55,   note: null },
  ];

  // Essential amino acids — WHO 2007 scoring pattern (mg per g protein)
  const AMINO_ACIDS = [
    { code: 'HISTN', label: 'Histidiini',        who: 18 },
    { code: 'ILE',   label: 'Isoleusiini',       who: 25 },
    { code: 'LEU',   label: 'Leusiini',          who: 55 },
    { code: 'LYS',   label: 'Lysiini',           who: 51 },
    { code: 'MET',   label: 'Met + Kys',         who: 25, extra: ['CYS'] },
    { code: 'PHE',   label: 'Fen + Tyr',         who: 47, extra: ['TYR'] },
    { code: 'THR',   label: 'Treoniini',         who: 27 },
    { code: 'TRP',   label: 'Tryptofaani',       who: 7  },
    { code: 'VAL',   label: 'Valiini',           who: 32 },
  ];

  // Plant-based food suggestions per gap (code → list)
  const SUGGESTIONS = {
    VITB12: 'Ravintohiiva (B12-väkevöity), väkevöidyt kasvijuomat — tai B12-lisäravinne',
    FE:     'Linssit, tofu, kikherneet, quinoa, kurpitsansiemenet, tumma suklaa',
    CA:     'Lehtikaali, parsakaali, tahini, väkevöidyt kasvijuomat, edamame',
    VITD:   'UV-altistetut sienet — D-vitamiinilisä on suositeltava erityisesti talviaikana',
    ZN:     'Hampunsiemenet, kurpitsansiemenet, cashewpähkinät, kikherneet, kaurahiutaleet',
    FAPUN3: 'Pellavansiemenet (jauhettu), chiansiemenet, saksanpähkinät, hampunsiemenet',
    IDD:    'Nori-merilevä, wakame — tai jodisoitu suola',
    SE:     'Parapähkinät (1–2 kpl/vrk riittää!), auringonkukansiemenet, cashewpähkinät',
    LYS:    'Linssit, kikherneet, tofu, tempeh, edamame — lysiinin paras kasvipohjainen lähde',
    MET:    'Auringonkukansiemenet, seesaminsiemenet, parapähkinät, kaurahiutaleet',
    TRP:    'Kurpitsansiemenet, tofu, kaura, auringonkukansiemenet, täysjyvävehnä',
    ILE:    'Tofu, linssit, hampunsiemenet, auringonkukansiemenet, quinoa',
    LEU:    'Soijapavut, tofu, linssit, hampunsiemenet, kaura',
    THR:    'Linssit, soijapavut, kikherneet, pähkinät, täysjyväviljat',
    VAL:    'Soijapavut, linssit, pähkinät, siemenet, täysjyväviljat',
    HISTN:  'Soijapavut, linssit, kikherneet, kvinoa, pähkinät',
    PHE:    'Soijapavut, linssit, mantelit, maapähkinät, auringonkukansiemenet',
  };

  /* ── APP STATE ────────────────────────────────────────────────── */
  const state = {
    mealItems:      [],   // { uid, name, grams, rawNutrients }
    pendingFood:    null, // food object waiting for gram-amount confirmation
    searchTimer:    null,
    uidCounter:     0,
  };

  /* ── HELPERS ──────────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmt(val, decimals) {
    if (val === null || val === undefined || isNaN(val)) return '–';
    return decimals === 0 ? Math.round(val).toString() : val.toFixed(decimals);
  }

  function pctClass(pct) {
    if (pct >= 75) return 'good';
    if (pct >= 25) return 'ok';
    return 'low';
  }

  /* ── TRANSLATION (Finnish → English for USDA fallback) ───────── */

  // Built-in dictionary for common Finnish food terms — fast, offline, no API needed.
  const FI_EN = {
    'herne':'peas','herneet':'peas','papu':'bean','pavut':'beans',
    'linssit':'lentils','linssi':'lentil',
    'kikherneet':'chickpeas','kikherneissä':'chickpeas',
    'tofu':'tofu','tempeh':'tempeh','seitan':'seitan',
    'soija':'soy','soijapavut':'soybeans','edamame':'edamame',
    'kaura':'oats','kaurahiutaleet':'oats',
    'riisi':'rice','täysjyvä':'whole grain','täysjyväriisi':'brown rice',
    'vehnä':'wheat','ohra':'barley','ruis':'rye','maissi':'corn',
    'tattari':'buckwheat','hirssi':'millet','kvinoa':'quinoa','quinoa':'quinoa',
    'amarantti':'amaranth','durra':'sorghum',
    'pinaatti':'spinach','lehtikaali':'kale','parsakaali':'broccoli',
    'kukkakaali':'cauliflower','kaali':'cabbage','ruusukaali':'brussels sprouts',
    'porkkana':'carrot','peruna':'potato','bataatti':'sweet potato',
    'punajuuri':'beet','nauris':'turnip','palsternakka':'parsnip',
    'tomaatti':'tomato','kurkku':'cucumber','paprika':'bell pepper',
    'sipuli':'onion','punasipuli':'red onion','valkosipuli':'garlic',
    'kesäkurpitsa':'zucchini','kurpitsa':'pumpkin','squash':'squash',
    'sieni':'mushroom','sienet':'mushrooms',
    'salaatti':'lettuce','rucola':'arugula','piparjuuri':'horseradish',
    'avokado':'avocado','banaani':'banana','omena':'apple','päärynä':'pear',
    'mansikka':'strawberry','mustikka':'blueberry','vadelma':'raspberry',
    'appelsiini':'orange','sitruuna':'lemon','lime':'lime',
    'mango':'mango','ananas':'pineapple','kiivi':'kiwi','papaya':'papaya',
    'taateli':'date','taatelit':'dates','rusina':'raisin','rusinat':'raisins',
    'manteli':'almond','mantelit':'almonds',
    'cashew':'cashew','cashewpähkinä':'cashew','cashewpähkinät':'cashews',
    'maapähkinä':'peanut','maapähkinät':'peanuts',
    'saksanpähkinä':'walnut','saksanpähkinät':'walnuts',
    'parapähkinä':'brazil nut','parapähkinät':'brazil nuts',
    'hasselpähkinä':'hazelnut','pähkinät':'nuts',
    'kurpitsansiemen':'pumpkin seed','kurpitsansiemenet':'pumpkin seeds',
    'auringonkukansiemen':'sunflower seed','auringonkukansiemenet':'sunflower seeds',
    'seesaminsiemen':'sesame seed','seesaminsiemenet':'sesame seeds',
    'pellavansiemen':'flaxseed','pellavansiemenet':'flaxseeds',
    'chiansiemen':'chia seed','chiansiemenet':'chia seeds',
    'hampunsiemen':'hemp seed','hampunsiemenet':'hemp seeds',
    'ravintohiiva':'nutritional yeast',
    'tahini':'tahini','hummus':'hummus',
    'kookosmaito':'coconut milk','kookosöljy':'coconut oil',
    'oliiviöljy':'olive oil','rypsiöljy':'canola oil',
    'soijajuoma':'soy milk','kaurajuoma':'oat milk',
    'mantelijuoma':'almond milk',
  };

  /**
   * Translate a Finnish food term to English.
   * Checks the built-in dictionary first (instant, works offline/file://).
   * Falls back to MyMemory API for unknown terms.
   */
  async function translateToEnglish(text) {
    const lower = text.trim().toLowerCase();
    if (FI_EN[lower]) return FI_EN[lower];
    // Try MyMemory for terms not in the dictionary
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=fi|en`;
      const res  = await fetch(url);
      const data = await res.json();
      const t    = data?.responseData?.translatedText;
      if (t && t.toLowerCase() !== lower) return t;
    } catch (_) { /* network error — use original */ }
    return text;
  }

  /* ── FINELI API (via WP proxy) ────────────────────────────────── */
  async function fineliSearch(query) {
    if (!PROXY_FINELI_SEARCH) throw new Error('no proxy');
    const url = `${PROXY_FINELI_SEARCH}?q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fineliFood(id) {
    if (!PROXY_FINELI_FOOD) throw new Error('no proxy');
    const url = `${PROXY_FINELI_FOOD}/${id}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ── USDA SEARCH (via WP proxy, used as fallback) ─────────────── */
  // Data types with complete nutrient profiles (incl. amino acids)
  const USDA_PREFERRED = ['SR Legacy', 'Foundation', 'Survey (FNDDS)'];

  async function usdaSearch(query) {
    if (!PROXY_USDA) throw new Error('no proxy');
    const url = `${PROXY_USDA}?query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Sort: comprehensive databases (SR Legacy / Foundation) first
    const foods = (data.foods || []).slice().sort((a, b) => {
      const ap = USDA_PREFERRED.includes(a.dataType) ? 0 : 1;
      const bp = USDA_PREFERRED.includes(b.dataType) ? 0 : 1;
      return ap - bp;
    });
    return foods.map(f => ({
      id:        `usda:${f.fdcId}`,
      name:      { fi: f.description, en: f.description },
      foodClass: { nameFi: f.dataType || '' },
      _usda:     f,
    }));
  }

  /* ── NUTRIENT EXTRACTION ──────────────────────────────────────── */
  /**
   * Normalise a Fineli food-detail response into a flat
   * { CODE: value_per_100g } map.
   *
   * Fineli may return nutrients under several keys depending on
   * API version — we try them all.
   */
  function extractNutrients(food) {
    const map = {};

    // Try: food.componentValues (most likely)
    const list =
      food.componentValues ||
      food.components      ||
      food.nutrients       ||
      [];

    list.forEach(c => {
      // Code may be under eufdname, id, code, or nutrient.eufdname
      const code =
        (c.eufdname && c.eufdname.toUpperCase()) ||
        (c.id       && typeof c.id === 'string' && c.id.toUpperCase()) ||
        (c.code     && c.code.toUpperCase())     ||
        (c.nutrient && c.nutrient.eufdname && c.nutrient.eufdname.toUpperCase());

      // Value may be under bestloc, value, amount
      const val = parseFloat(c.bestloc ?? c.value ?? c.amount ?? 0) || 0;

      if (code) map[code] = val;
    });

    return map;
  }

  /** Scale raw per-100g nutrients to actual gram amount */
  function scale(rawNutrients, grams) {
    const out = {};
    for (const [k, v] of Object.entries(rawNutrients)) {
      out[k] = v * grams / 100;
    }
    return out;
  }

  /** Sum nutrients across all meal items */
  function sumMeal() {
    const total = {};
    state.mealItems.forEach(item => {
      const s = scale(item.rawNutrients, item.grams);
      for (const [k, v] of Object.entries(s)) {
        total[k] = (total[k] || 0) + v;
      }
    });
    return total;
  }

  /* ── AMINO ACID ANALYSIS ──────────────────────────────────────── */
  function analyseAmino(totals) {
    const protein = totals['PROT'] || 0;
    if (protein < 1) return null; // need at least 1g protein

    return AMINO_ACIDS.map(aa => {
      // Sum primary code + any extra codes (e.g. MET + CYS)
      let mg = totals[aa.code] || 0;
      if (aa.extra) aa.extra.forEach(c => { mg += totals[c] || 0; });

      // mg per g of protein
      const mgPerG = protein > 0 ? mg / protein : 0;
      const pct    = aa.who > 0 ? Math.round((mgPerG / aa.who) * 100) : 0;

      return { ...aa, mg: Math.round(mg * 10) / 10, mgPerG: Math.round(mgPerG * 10) / 10, pct };
    });
  }

  /* ── RECOMMENDATIONS ──────────────────────────────────────────── */
  function buildRecs(totals, aminoScores) {
    const recs = [];

    KEY_NUTRIENTS.forEach(n => {
      const val = totals[n.code] || 0;
      const pct = n.rda > 0 ? (val / n.rda) * 100 : 100;
      if (pct < 30 && SUGGESTIONS[n.code]) {
        recs.push({ gap: n.label, text: SUGGESTIONS[n.code] });
      }
    });

    if (aminoScores) {
      aminoScores.forEach(aa => {
        if (aa.pct < 75 && SUGGESTIONS[aa.code]) {
          recs.push({ gap: aa.label, text: SUGGESTIONS[aa.code] });
        }
      });
    }

    return recs;
  }

  /* ── RENDERING ────────────────────────────────────────────────── */

  function renderMealList() {
    const list    = $('dbp-meal-list');
    const clearBtn = $('dbp-clear-meal');

    if (state.mealItems.length === 0) {
      list.innerHTML = `
        <div class="dbp-meal-empty">
          <span class="dbp-meal-empty__icon">&#127821;</span>
          <p>Hae ja lisää ruoka-aineita<br>aterialle yllä olevalla haulla</p>
        </div>`;
      clearBtn.style.display = 'none';
      return;
    }

    clearBtn.style.display = '';
    list.innerHTML = state.mealItems.map((item, idx) => `
      <div class="dbp-meal-item" data-uid="${item.uid}">
        <span class="dbp-meal-item__name" title="${item.name}">${item.name}</span>
        <input
          type="number"
          class="dbp-gram-input"
          value="${item.grams}"
          min="1"
          max="5000"
          data-idx="${idx}"
          aria-label="Määrä grammoina"
        >
        <span class="dbp-meal-item__unit">g</span>
        <button class="dbp-meal-item__remove" data-idx="${idx}" aria-label="Poista">&#10005;</button>
      </div>`).join('');
  }

  function renderAnalysis() {
    const emptyEl   = $('dbp-analysis-empty');
    const contentEl = $('dbp-analysis-content');

    if (state.mealItems.length === 0) {
      emptyEl.style.display   = '';
      contentEl.style.display = 'none';
      return;
    }

    emptyEl.style.display   = 'none';
    contentEl.style.display = '';

    const totals = sumMeal();

    /* MACROS */
    $('dbp-macros').innerHTML = MACROS.map(m => {
      const val = totals[m.code] || 0;
      return `<div class="dbp-macro-card">
        <div class="dbp-macro-card__value">${fmt(val, m.decimals)}<span class="dbp-macro-card__unit">&nbsp;${m.unit}</span></div>
        <div class="dbp-macro-card__label">${m.label}</div>
      </div>`;
    }).join('');

    /* KEY NUTRIENTS */
    $('dbp-key-nutrients').innerHTML = KEY_NUTRIENTS.map(n => {
      const val    = totals[n.code] || 0;
      const rawPct = n.rda > 0 ? (val / n.rda) * 100 : 0;
      const barW   = Math.min(rawPct, 100);
      const cls    = pctClass(rawPct);
      const dispVal = val < 10 ? val.toFixed(1) : Math.round(val);
      const noteAttr = n.note ? ` title="${n.note}"` : '';
      const noteIcon = n.note ? ' <sup style="font-size:0.6rem;opacity:0.6">ℹ</sup>' : '';
      return `<div class="dbp-nutrient-row">
        <span class="dbp-nutrient-label"${noteAttr}>${n.label}${noteIcon}</span>
        <div class="dbp-nutrient-bar-wrap">
          <div class="dbp-nutrient-bar dbp-nutrient-bar--${cls}" style="width:${barW}%"></div>
        </div>
        <span class="dbp-nutrient-pct dbp-nutrient-pct--${cls}">${Math.round(rawPct)}&nbsp;%</span>
        <span class="dbp-nutrient-value">${dispVal}&nbsp;${n.unit}</span>
      </div>`;
    }).join('');

    /* AMINO ACIDS */
    const aminoScores = analyseAmino(totals);
    const aminoEl = $('dbp-amino-acids');

    if (!aminoScores) {
      aminoEl.innerHTML = '<p class="dbp-amino-nodata">Lisää proteiinipitoisia ruokia (väh. 1 g proteiinia) aminohappoanalyysiä varten.</p>';
    } else {
      aminoEl.innerHTML = aminoScores.map(aa => {
        const cls  = pctClass(aa.pct);
        const barW = Math.min(aa.pct, 100);
        return `<div class="dbp-amino-item dbp-amino-item--${cls}">
          <div class="dbp-amino-item__header">
            <span class="dbp-amino-item__name">${aa.label}</span>
            <span class="dbp-amino-item__pct">${aa.pct}&nbsp;%</span>
          </div>
          <div class="dbp-amino-item__bar">
            <div class="dbp-amino-item__fill" style="width:${barW}%"></div>
          </div>
        </div>`;
      }).join('');
    }

    /* RECOMMENDATIONS */
    const recs    = buildRecs(totals, aminoScores);
    const recsEl  = $('dbp-recommendations');
    const recsCnt = $('dbp-recommendations-content');

    if (recs.length > 0) {
      recsEl.style.display = '';
      recsCnt.innerHTML = recs.map(r => `
        <div class="dbp-rec-item">
          <span class="dbp-rec-gap">&#8595;&nbsp;${r.gap}</span>
          <span class="dbp-rec-text">${r.text}</span>
        </div>`).join('');
    } else {
      recsEl.style.display = 'none';
    }
  }

  /* ── SEARCH UI ────────────────────────────────────────────────── */

  function showResults(html) {
    const el = $('dbp-search-results');
    el.innerHTML  = html;
    el.style.display = '';
  }

  function hideResults() {
    $('dbp-search-results').style.display = 'none';
  }

  function renderSearchResults(items) {
    if (!items || items.length === 0) {
      showResults('<div class="dbp-search-no-results">Ei tuloksia. Kokeile eri hakusanaa.</div>');
      return;
    }
    const html = items.slice(0, 12).map(food => {
      const name = food.name?.fi || food.name?.en || (typeof food.name === 'string' ? food.name : '?');
      const type = food.foodClass?.nameFi || food.type?.nameFi || '';
      return `<div class="dbp-search-result-item" role="option" tabindex="0"
                   data-id="${escapeHtml(food.id)}" data-name="${escapeHtml(name)}">
        <span class="dbp-search-result-name">${escapeHtml(name)}</span>
        ${type ? `<span class="dbp-search-result-type">${escapeHtml(type)}</span>` : ''}
      </div>`;
    }).join('');
    showResults(html);
  }

  /* ── ADD-FORM (inline gram picker) ───────────────────────────── */

  function showAddForm(foodObj) {
    removeAddForm();
    state.pendingFood = foodObj;

    const form = document.createElement('div');
    form.className = 'dbp-add-form';
    form.id = 'dbp-add-form';
    form.innerHTML = `
      <span class="dbp-add-form__name">${foodObj.name}</span>
      <input type="number" id="dbp-gram-new" value="100" min="1" max="5000" aria-label="Grammamäärä">
      <span class="dbp-add-form__unit">g</span>
      <button class="dbp-btn dbp-btn--primary" id="dbp-confirm-add">Lisää</button>
      <button class="dbp-btn dbp-btn--cancel" id="dbp-cancel-add">Peru</button>`;

    $('dbp-meal-list').appendChild(form);
    const inp = $('dbp-gram-new');
    inp.focus();
    inp.select();
  }

  function removeAddForm() {
    const f = $('dbp-add-form');
    if (f) f.remove();
    state.pendingFood = null;
  }

  function confirmAdd() {
    if (!state.pendingFood) return;
    const grams = Math.max(1, parseInt($('dbp-gram-new').value, 10) || 100);
    state.uidCounter++;
    state.mealItems.push({
      uid:          state.uidCounter,
      name:         state.pendingFood.name,
      grams,
      rawNutrients: state.pendingFood.rawNutrients,
    });
    removeAddForm();
    renderMealList();
    renderAnalysis();
  }

  /* ── SELECT FOOD FROM SEARCH ──────────────────────────────────── */

  async function selectFood(id, name) {
    hideResults();
    $('dbp-search-input').value = '';
    $('dbp-search-clear').style.display = 'none';

    removeAddForm();
    const placeholder = document.createElement('div');
    placeholder.id = 'dbp-add-form';
    placeholder.className = 'dbp-add-form';
    placeholder.innerHTML = `<span class="dbp-spinner"></span> Ladataan: ${escapeHtml(name)}`;
    $('dbp-meal-list').appendChild(placeholder);

    // USDA items have id prefixed with "usda:"
    if (String(id).startsWith('usda:')) {
      const fdcId = String(id).replace('usda:', '');
      try {
        const rawNutrients = await fetchUsdaNutrients(fdcId);
        placeholder.remove();
        showAddForm({ id, name, rawNutrients });
      } catch {
        placeholder.remove();
        alert('Ruoka-aineen tiedot eivät saatavilla juuri nyt.');
      }
      return;
    }

    try {
      const food         = await fineliFood(id);
      const rawNutrients = extractNutrients(food);
      const foodName     = food.name?.fi || food.name?.en || name;
      placeholder.remove();
      showAddForm({ id, name: foodName, rawNutrients });
    } catch {
      placeholder.remove();
      tryUsdaFallback(name);
    }
  }

  /* ── USDA FALLBACK (via server-side proxy — key never reaches browser) ── */
  /** Extract nutrients from a USDA foodNutrients array into our code map */
  function extractUsdaNutrients(foodNutrients) {
    const raw = {};
    (foodNutrients || []).forEach(n => {
      const code = usdaCodeMap(n.nutrientId || n.nutrientNumber);
      if (code) raw[code] = parseFloat(n.value) || 0;
    });
    return raw;
  }

  /**
   * Fetch full nutrient profile for a USDA food by fdcId.
   * Uses the detail endpoint which includes amino acids; falls back to
   * re-querying search (which may lack amino acids) if detail not available.
   */
  async function fetchUsdaNutrients(fdcId) {
    if (PROXY_USDA_DETAIL) {
      // WP proxy: /dbp/v1/usda/food/{fdcId}
      // test.html: direct USDA detail URL + optional key param
      const keyParam = USDA_KEY ? `?api_key=${USDA_KEY}` : '';
      const res  = await fetch(`${PROXY_USDA_DETAIL}/${fdcId}${keyParam}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return extractUsdaNutrients(data.foodNutrients);
    }
    // Legacy: re-query search by fdcId (amino acids may be missing)
    const res  = await fetch(`${PROXY_USDA}?query=${encodeURIComponent(fdcId)}`);
    const data = await res.json();
    const food = data.foods?.[0];
    if (!food) throw new Error('not found');
    return extractUsdaNutrients(food.foodNutrients);
  }

  /** Fallback: when Fineli food detail fails, search USDA by name (translated) */
  async function tryUsdaFallback(query) {
    if (!PROXY_USDA) {
      alert('Ruoka-aineen tiedot eivät saatavilla juuri nyt.');
      return;
    }
    try {
      const eq   = await translateToEnglish(query);
      const res  = await fetch(`${PROXY_USDA}?query=${encodeURIComponent(eq)}`);
      const data = await res.json();
      const food = (data.foods || []).find(f => USDA_PREFERRED.includes(f.dataType)) || data.foods?.[0];
      if (!food) throw new Error('not found');
      const rawNutrients = await fetchUsdaNutrients(food.fdcId);
      showAddForm({ id: `usda:${food.fdcId}`, name: food.description, rawNutrients });
    } catch {
      alert('Ruoka-ainetta ei löydy tällä hetkellä. Kokeile toista hakusanaa.');
    }
  }

  /** Map USDA nutrient IDs to our EuroFIR-like codes */
  function usdaCodeMap(id) {
    const MAP = {
      1008: 'ENERC',   // Energy kcal
      1003: 'PROT',    // Protein
      1004: 'FAT',     // Total fat
      1005: 'CHOAVL',  // Carbohydrates
      1079: 'FIBT',    // Fiber
      1087: 'CA',      // Calcium
      1089: 'FE',      // Iron
      1114: 'VITD',    // Vitamin D
      1178: 'VITB12',  // Vitamin B12
      1095: 'ZN',      // Zinc
      1100: 'IDD',     // Iodine
      1103: 'SE',      // Selenium
      1404: 'FAPUN3',  // ALA omega-3
      // Amino acids
      1221: 'HISTN',
      1212: 'ILE',
      1213: 'LEU',
      1214: 'LYS',
      1215: 'MET',
      1216: 'PHE',
      1211: 'THR',
      1210: 'TRP',
      1217: 'VAL',
      1232: 'CYS',
      1219: 'TYR',
    };
    return MAP[parseInt(id, 10)] || null;
  }

  /* ── EVENT WIRING ─────────────────────────────────────────────── */

  function initEvents() {
    const searchInput = $('dbp-search-input');
    const clearBtn    = $('dbp-search-clear');
    const resultsEl   = $('dbp-search-results');

    /* Search input */
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      clearBtn.style.display = q ? '' : 'none';
      if (state.searchTimer) clearTimeout(state.searchTimer);
      if (q.length < 2) { hideResults(); return; }

      state.searchTimer = setTimeout(() => {
        showResults('<div class="dbp-search-loading"><span class="dbp-spinner"></span>Haetaan&hellip;</div>');
        fineliSearch(q)
          .then(renderSearchResults)
          .catch(async () => {
            // Fineli unavailable — translate Finnish to English for USDA
            const eq = await translateToEnglish(q);
            return usdaSearch(eq)
              .then(renderSearchResults)
              .catch(() => {
                showResults('<div class="dbp-search-error">Haku epäonnistui. Tarkista verkkoyhteytesi.</div>');
              });
          });
      }, 320);
    });

    /* Clear search */
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.style.display = 'none';
      hideResults();
      searchInput.focus();
    });

    /* Global click delegation */
    document.addEventListener('click', e => {

      // Click on search result
      const resultItem = e.target.closest('.dbp-search-result-item');
      if (resultItem) {
        selectFood(resultItem.dataset.id, resultItem.dataset.name);
        return;
      }

      // Confirm add
      if (e.target.id === 'dbp-confirm-add') { confirmAdd(); return; }

      // Cancel add
      if (e.target.id === 'dbp-cancel-add') { removeAddForm(); renderMealList(); return; }

      // Remove meal item
      const removeBtn = e.target.closest('.dbp-meal-item__remove');
      if (removeBtn) {
        const idx = parseInt(removeBtn.dataset.idx, 10);
        state.mealItems.splice(idx, 1);
        renderMealList();
        renderAnalysis();
        return;
      }

      // Click outside search → hide results
      if (!e.target.closest('#dbp-search-results') &&
          !e.target.closest('#dbp-search-input')) {
        hideResults();
      }
    });

    /* Gram input change — live recalculate */
    document.addEventListener('change', e => {
      const inp = e.target.closest('.dbp-gram-input');
      if (!inp) return;
      const idx   = parseInt(inp.dataset.idx, 10);
      const grams = Math.max(1, parseInt(inp.value, 10) || 100);
      inp.value = grams;
      state.mealItems[idx].grams = grams;
      renderAnalysis();
    });

    /* Keyboard shortcuts */
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.id === 'dbp-gram-new') {
        confirmAdd();
        return;
      }
      if (e.key === 'Escape') {
        removeAddForm();
        renderMealList();
        hideResults();
        return;
      }
      // Keyboard nav in search results
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
           document.activeElement === searchInput) {
        e.preventDefault();
        const items = resultsEl.querySelectorAll('.dbp-search-result-item');
        if (items.length) items[0].focus();
      }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
           e.target.closest('#dbp-search-results')) {
        e.preventDefault();
        const items = [...resultsEl.querySelectorAll('.dbp-search-result-item')];
        const idx   = items.indexOf(e.target);
        const next  = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
        if (items[next]) items[next].focus();
      }
      if (e.key === 'Enter' && e.target.closest('#dbp-search-results')) {
        e.target.click();
      }
    });

    /* Clear meal button */
    $('dbp-clear-meal').addEventListener('click', () => {
      if (!confirm('Tyhjennetäänkö koko ateria?')) return;
      state.mealItems = [];
      removeAddForm();
      renderMealList();
      renderAnalysis();
    });
  }

  /* ── INIT ─────────────────────────────────────────────────────── */
  function init() {
    if (!$('dbp-app')) return;
    renderMealList();
    renderAnalysis();
    initEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
