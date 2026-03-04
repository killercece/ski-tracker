/* Ski Tracker - JavaScript principal (Vanilla JS) */

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

async function api(url, options) {
    try {
        var res = await fetch(url, options);
        if (!res.ok) {
            var body = await res.json().catch(function() { return {}; });
            throw new Error(body.error || 'Erreur ' + res.status);
        }
        return await res.json();
    } catch (err) {
        showToast(err.message, 'error');
        throw err;
    }
}

function showToast(message, type) {
    type = type || 'success';
    var container = document.getElementById('toast-container');
    var toast = document.createElement('div');
    var bgClass = type === 'error'
        ? 'bg-red-600'
        : type === 'warning' ? 'bg-amber-600' : 'bg-primary-600';
    toast.className = 'toast-enter flex items-center gap-2 px-4 py-3 rounded-lg text-white text-sm font-medium shadow-lg ' + bgClass;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function() {
        toast.classList.remove('toast-enter');
        toast.classList.add('toast-exit');
        toast.addEventListener('animationend', function() { toast.remove(); });
    }, 3000);
}

function formatDuration(seconds) {
    if (!seconds && seconds !== 0) return '--:--';
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = Math.floor(seconds % 60);
    if (h > 0) return h + 'h' + String(m).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        var d = new Date(dateStr + 'T12:00:00');
        return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { return dateStr; }
}

function formatTime(dateStr) {
    if (!dateStr) return '--:--';
    try {
        var d = new Date(dateStr);
        return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return '--:--'; }
}

function fmt1(n) {
    if (n == null || isNaN(n)) return '--';
    return Number(n).toFixed(1);
}

function fmt0(n) {
    if (n == null || isNaN(n)) return '--';
    return Math.round(Number(n)).toLocaleString('fr-FR');
}

function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
}

function pisteColor(difficulty) {
    var colors = {
        'novice': '#22c55e', 'easy': '#22c55e',
        'intermediate': '#3b82f6',
        'advanced': '#ef4444',
        'expert': '#18181b',
        'freeride': '#f97316'
    };
    return colors[difficulty] || '#9ca3af';
}

function pisteBadgeClass(difficulty) {
    var classes = {
        'novice': 'green', 'easy': 'green',
        'intermediate': 'blue',
        'advanced': 'red',
        'expert': 'black',
        'freeride': 'orange'
    };
    return classes[difficulty] || '';
}

function pisteDifficultyLabel(difficulty) {
    var labels = {
        'novice': 'Verte', 'easy': 'Verte',
        'intermediate': 'Bleue',
        'advanced': 'Rouge',
        'expert': 'Noire',
        'freeride': 'Freeride'
    };
    return labels[difficulty] || difficulty || '';
}

// ---------------------------------------------------------------------------
// Theme sombre / clair
// ---------------------------------------------------------------------------

function toggleTheme() {
    var html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    }
}

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
    } catch (e) {
        window.location.href = '/login';
    }
}

// ---------------------------------------------------------------------------
// Sidebar mobile
// ---------------------------------------------------------------------------

function toggleSidebar() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('hidden');
}

// ---------------------------------------------------------------------------
// Routeur client-side (SPA)
// ---------------------------------------------------------------------------

function navigateTo(path) {
    history.pushState(null, '', path);
    routeChanged();
}

function navigateToDate(dateStr) {
    if (dateStr) navigateTo('/day/' + dateStr);
}

function routeChanged() {
    var path = window.location.pathname;
    var match = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/);

    if (match) {
        showDayView(match[1]);
    } else {
        showDashboardView();
    }
}

function showDashboardView() {
    document.getElementById('view-dashboard').classList.remove('hidden');
    document.getElementById('view-day').classList.add('hidden');
    loadGlobalStats();
    loadDaysList();
}

function showDayView(dateStr) {
    document.getElementById('view-dashboard').classList.add('hidden');
    document.getElementById('view-day').classList.remove('hidden');
    document.getElementById('date-picker').value = dateStr;
    setText('day-title', formatDate(dateStr));
    loadDayData(dateStr);
}

window.addEventListener('popstate', routeChanged);

// ---------------------------------------------------------------------------
// Dashboard : Stats globales
// ---------------------------------------------------------------------------

async function loadGlobalStats() {
    try {
        var data = await api('/api/stats');
        setText('stat-sessions', data.total_sessions || 0);
        setText('stat-distance', fmt1(data.total_distance));
        setText('stat-elevation', fmt0(data.total_elevation_gain));
        setText('stat-max-speed', fmt1(data.max_speed));
        setText('stat-descents', data.total_descents || 0);
    } catch (e) {}
}

// ---------------------------------------------------------------------------
// Dashboard : Liste des journees
// ---------------------------------------------------------------------------

var sessionsCache = null;

async function loadDaysList() {
    try {
        sessionsCache = await api('/api/sessions');
        var container = document.getElementById('days-list');
        var emptyEl = document.getElementById('days-empty');
        if (!container) return;

        if (!sessionsCache || sessionsCache.length === 0) {
            container.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }

        if (emptyEl) emptyEl.classList.add('hidden');

        container.innerHTML = sessionsCache.map(function(s) {
            return '<a href="/day/' + s.date + '" onclick="navigateTo(\'/day/' + s.date + '\'); return false;" ' +
                'class="session-card block rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:border-primary-500 transition-all">' +
                '<div class="flex items-center justify-between mb-3">' +
                    '<h3 class="font-semibold">' + formatDate(s.date) + '</h3>' +
                    '<svg class="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>' +
                '</div>' +
                '<div class="grid grid-cols-3 gap-3 text-sm">' +
                    '<div><span class="text-xs text-zinc-500 dark:text-zinc-400 block">Distance</span><span class="font-semibold tabular-nums">' + fmt1(s.total_distance) + ' km</span></div>' +
                    '<div><span class="text-xs text-zinc-500 dark:text-zinc-400 block">Denivele</span><span class="font-semibold tabular-nums">' + fmt0(s.total_elevation_gain) + ' m</span></div>' +
                    '<div><span class="text-xs text-zinc-500 dark:text-zinc-400 block">Descentes</span><span class="font-semibold tabular-nums">' + (s.num_descents || 0) + '</span></div>' +
                '</div>' +
            '</a>';
        }).join('');
    } catch (e) {}
}

// ---------------------------------------------------------------------------
// Vue jour : Navigation par date
// ---------------------------------------------------------------------------

var availableDates = [];
var currentDateIndex = -1;
var dayMap = null;
var dayTrackLayers = {};
var currentFlatTracks = null;
var timelineData = [];

function updateNavButtons() {
    var prevBtn = document.getElementById('prev-day-btn');
    var nextBtn = document.getElementById('next-day-btn');
    if (prevBtn) prevBtn.disabled = currentDateIndex >= availableDates.length - 1;
    if (nextBtn) nextBtn.disabled = currentDateIndex <= 0;
}

function prevDay() {
    if (currentDateIndex < availableDates.length - 1) {
        currentDateIndex++;
        navigateTo('/day/' + availableDates[currentDateIndex]);
    }
}

function nextDay() {
    if (currentDateIndex > 0) {
        currentDateIndex--;
        navigateTo('/day/' + availableDates[currentDateIndex]);
    }
}

async function loadDayData(dateStr) {
    if (availableDates.length === 0) {
        try {
            availableDates = await api('/api/dates');
        } catch (e) { availableDates = []; }
    }

    closePisteDetail();

    var idx = availableDates.indexOf(dateStr);
    if (idx >= 0) currentDateIndex = idx;
    updateNavButtons();

    try {
        if (!sessionsCache) {
            sessionsCache = await api('/api/sessions');
        }
        var sess = sessionsCache.find(function(s) { return s.date === dateStr; });

        if (!sess) {
            showToast('Aucune session pour cette date', 'warning');
            navigateTo('/');
            return;
        }

        var tracksData = await api('/api/sessions/' + sess.id + '/tracks');

        setText('day-distance', fmt1(sess.total_distance));
        setText('day-elev-gain', fmt0(sess.total_elevation_gain));
        setText('day-elev-loss', fmt0(sess.total_elevation_loss));
        setText('day-duration', formatDuration(sess.duration_seconds));
        setText('day-avg-speed', fmt1(sess.avg_speed));
        setText('day-max-speed', fmt1(sess.max_speed));
        setText('day-descents', sess.num_descents || 0);

        var flatTracks = tracksData.map(function(item) {
            var flat = Object.assign({}, item.track);
            flat.points = item.points;
            return flat;
        });
        currentFlatTracks = flatTracks;
        renderDayMap(flatTracks, sess.id);
        renderDayDescentsTable(flatTracks);
    } catch (e) {}
}

// ---------------------------------------------------------------------------
// Vue jour : Carte Leaflet
// ---------------------------------------------------------------------------

function renderDayMap(tracks, sessionId) {
    var mapEl = document.getElementById('day-map');
    if (!mapEl || !tracks || tracks.length === 0) return;

    if (dayMap) { dayMap.remove(); dayMap = null; }
    dayTrackLayers = {};

    dayMap = L.map('day-map', { zoomControl: true, scrollWheelZoom: true });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap', maxZoom: 18
    }).addTo(dayMap);

    var allBounds = [];
    var overlays = {
        'Descentes': L.layerGroup(),
        'Remontees': L.layerGroup()
    };

    // Utiliser la timeline groupee (meme logique que le tableau)
    var timeline = buildTimeline(tracks);

    timeline.forEach(function(item) {
        if (!item.points || item.points.length < 2) return;

        var isLift = item.type === 'lift';
        var latlngs = item.points.map(function(p) { return [p.latitude, p.longitude]; });

        // Style différencié
        var polylineStyle;
        if (isLift) {
            polylineStyle = { color: '#93c5fd', weight: 2, opacity: 0.4, dashArray: '6 8' };
        } else {
            polylineStyle = { color: pisteColor(item.piste_difficulty), weight: 4, opacity: 0.85 };
        }

        var polyline = L.polyline(latlngs, polylineStyle);

        // Popup
        var popupContent = '<div style="font-family: Inter, sans-serif; font-size: 13px; line-height: 1.5;">';
        if (isLift) {
            var liftName = item.piste_name ? item.piste_name : 'Remontee';
            popupContent += '<strong>' + liftName + ' #' + item.num + '</strong>' +
                '<br>Duree : ' + formatDuration(item.duration_seconds) +
                '<br>Denivele : ' + fmt0(Math.abs(item.elevation_change)) + ' m';
        } else {
            popupContent += '<strong>Descente #' + item.num + '</strong>';
            popupContent += '<br>Piste : <strong>' + item.piste_name + '</strong>';
            if (item.piste_difficulty) popupContent += ' (' + pisteDifficultyLabel(item.piste_difficulty) + ')';
            popupContent += '<br>Distance : ' + fmt1(item.distance) + ' km' +
                '<br>Denivele : ' + fmt0(Math.abs(item.elevation_change)) + ' m' +
                '<br>Duree : ' + formatDuration(item.duration_seconds) +
                '<br>Vit. moy : ' + fmt1(item.avg_speed) + ' km/h' +
                '<br>Vit. max : ' + fmt1(item.max_speed) + ' km/h';
        }
        popupContent += '</div>';
        polyline.bindPopup(popupContent);

        // Stocker chaque track_id du groupe pour zoomToTracks
        item.track_ids.forEach(function(tid) { dayTrackLayers[tid] = polyline; });

        // Ajouter au layer group
        var layerName = isLift ? 'Remontees' : 'Descentes';
        overlays[layerName].addTo(dayMap);
        polyline.addTo(overlays[layerName]);

        // Marqueur numéroté au début du segment
        var bgColor = isLift ? '#93c5fd' : pisteColor(item.piste_difficulty);
        var icon = L.divIcon({
            html: '<div style="width:20px;height:20px;background:' + bgColor + ';border:2px solid white;border-radius:50%;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);">' + item.num + '</div>',
            iconSize: [20, 20], iconAnchor: [10, 10], className: ''
        });
        L.marker(latlngs[0], { icon: icon }).addTo(dayMap);

        latlngs.forEach(function(ll) { allBounds.push(ll); });
    });

    Object.keys(overlays).forEach(function(name) {
        overlays[name].addTo(dayMap);
    });

    if (allBounds.length > 0) {
        dayMap.fitBounds(allBounds, { padding: [30, 30] });
    }

    L.control.layers(null, overlays, { collapsed: false }).addTo(dayMap);
}

// ---------------------------------------------------------------------------
// Timeline : grouper pistes et remontees consecutives
// ---------------------------------------------------------------------------

function buildTimeline(tracks) {
    var timeline = [];
    var stepNum = 0;

    for (var i = 0; i < tracks.length; i++) {
        var t = tracks[i];

        if (t.segment_type === 'descent' && t.piste_name) {
            var last = timeline.length > 0 ? timeline[timeline.length - 1] : null;
            if (last && last.type === 'descent' && last.piste_name === t.piste_name) {
                last.distance += (t.distance || 0);
                last.elevation_change += (t.elevation_change || 0);
                last.duration_seconds += (t.duration_seconds || 0);
                last.max_speed = Math.max(last.max_speed || 0, t.max_speed || 0);
                last._total_speed_time += (t.avg_speed || 0) * (t.duration_seconds || 0);
                last._total_time += (t.duration_seconds || 0);
                last.avg_speed = last._total_time > 0 ? last._total_speed_time / last._total_time : 0;
                last.track_ids.push(t.id);
                last.points = last.points.concat(t.points || []);
                if (!last.end_time || (t.end_time && t.end_time > last.end_time)) last.end_time = t.end_time;
            } else {
                stepNum++;
                timeline.push({
                    type: 'descent',
                    num: stepNum,
                    piste_name: t.piste_name,
                    piste_difficulty: t.piste_difficulty,
                    start_time: t.start_time,
                    end_time: t.end_time,
                    distance: t.distance || 0,
                    elevation_change: t.elevation_change || 0,
                    duration_seconds: t.duration_seconds || 0,
                    avg_speed: t.avg_speed || 0,
                    max_speed: t.max_speed || 0,
                    match_confidence: t.match_confidence,
                    track_ids: [t.id],
                    points: t.points ? t.points.slice() : [],
                    _total_speed_time: (t.avg_speed || 0) * (t.duration_seconds || 0),
                    _total_time: t.duration_seconds || 0
                });
            }
        } else if (t.segment_type === 'lift') {
            var last = timeline.length > 0 ? timeline[timeline.length - 1] : null;
            if (last && last.type === 'lift' && t.piste_name && last.piste_name === t.piste_name) {
                last.distance += (t.distance || 0);
                last.elevation_change += (t.elevation_change || 0);
                last.duration_seconds += (t.duration_seconds || 0);
                last.max_speed = Math.max(last.max_speed || 0, t.max_speed || 0);
                last._total_speed_time += (t.avg_speed || 0) * (t.duration_seconds || 0);
                last._total_time += (t.duration_seconds || 0);
                last.avg_speed = last._total_time > 0 ? last._total_speed_time / last._total_time : 0;
                last.track_ids.push(t.id);
                last.points = last.points.concat(t.points || []);
                if (!last.end_time || (t.end_time && t.end_time > last.end_time)) last.end_time = t.end_time;
            } else {
                stepNum++;
                timeline.push({
                    type: 'lift',
                    num: stepNum,
                    piste_name: t.piste_name || null,
                    start_time: t.start_time,
                    end_time: t.end_time,
                    distance: t.distance || 0,
                    elevation_change: t.elevation_change || 0,
                    duration_seconds: t.duration_seconds || 0,
                    avg_speed: t.avg_speed || 0,
                    max_speed: t.max_speed || 0,
                    track_ids: [t.id],
                    points: t.points ? t.points.slice() : [],
                    _total_speed_time: (t.avg_speed || 0) * (t.duration_seconds || 0),
                    _total_time: t.duration_seconds || 0
                });
            }
        }
    }
    return timeline;
}

// ---------------------------------------------------------------------------
// Vue jour : Tableau des descentes
// ---------------------------------------------------------------------------

function renderDayDescentsTable(tracks) {
    var tbody = document.getElementById('day-descents-table');
    var emptyEl = document.getElementById('day-descents-empty');
    if (!tbody) return;

    var timeline = buildTimeline(tracks);

    // Stocker dans la variable globale pour showPisteDetail
    timelineData = timeline;

    if (timeline.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    tbody.innerHTML = timeline.map(function(item, idx) {
        var isLift = item.type === 'lift';
        var rowClass = isLift ? ' class="lift-row"' : ' class="descent-row"';
        var typeIcon = isLift
            ? '<svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18"/></svg>'
            : '<svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3"/></svg>';

        var nameCell = '';
        if (isLift) {
            if (item.piste_name) {
                nameCell = '<span class="text-zinc-500 dark:text-zinc-400 text-xs">' + item.piste_name + '</span>';
            } else {
                nameCell = '<span class="text-zinc-400 dark:text-zinc-500 text-xs">Remontee</span>';
            }
        } else {
            var badgeClass = pisteBadgeClass(item.piste_difficulty);
            nameCell = '<span class="piste-badge ' + badgeClass + '"><span class="dot"></span>' + item.piste_name + '</span>';
        }

        var onclick = isLift
            ? 'zoomToTracks([' + item.track_ids.join(',') + '])'
            : 'showPisteDetail(' + idx + ')';

        return '<tr onclick="' + onclick + '"' + rowClass + '>' +
            '<td class="px-4 py-3 font-medium text-zinc-400 text-xs">' + item.num + '</td>' +
            '<td class="px-4 py-3 text-center">' + typeIcon + '</td>' +
            '<td class="px-4 py-3">' + nameCell + '</td>' +
            '<td class="px-4 py-3 text-zinc-500 dark:text-zinc-400">' + formatTime(item.start_time) + '</td>' +
            '<td class="px-4 py-3">' + formatDuration(item.duration_seconds) + '</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' + fmt1(item.distance) + ' km</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' + fmt0(Math.abs(item.elevation_change)) + ' m</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' + fmt1(item.avg_speed) + ' km/h</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' + fmt1(item.max_speed) + ' km/h</td>' +
        '</tr>';
    }).join('');
}

function zoomToTracks(trackIds) {
    var bounds = [];
    trackIds.forEach(function(id) {
        var layer = dayTrackLayers[id];
        if (layer && dayMap) {
            var b = layer.getBounds();
            bounds.push(b.getSouthWest());
            bounds.push(b.getNorthEast());
        }
    });
    if (bounds.length > 0 && dayMap) {
        dayMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        // Ouvrir le popup du premier track
        if (dayTrackLayers[trackIds[0]]) dayTrackLayers[trackIds[0]].openPopup();
    }
}

// Garder l'ancien nom pour compatibilite
function zoomToDayTrack(trackId) { zoomToTracks([trackId]); }

function computePointSpeeds(points) {
    if (!points || points.length < 2) return points;
    var result = [];
    for (var i = 0; i < points.length; i++) {
        var p = Object.assign({}, points[i]);
        if (i === 0) {
            p.speed = 0;
        } else {
            var p0 = points[i - 1];
            var dlat = (p.latitude - p0.latitude) * 111320;
            var dlon = (p.longitude - p0.longitude) * 111320 * Math.cos(p0.latitude * Math.PI / 180);
            var dz = (p.elevation || 0) - (p0.elevation || 0);
            var dist = Math.sqrt(dlat * dlat + dlon * dlon + dz * dz);
            var t0 = p0.time ? new Date(p0.time).getTime() : 0;
            var t1 = p.time ? new Date(p.time).getTime() : 0;
            var dt = (t1 - t0) / 1000; // secondes
            p.speed = dt > 0 ? (dist / dt) * 3.6 : 0; // km/h
        }
        result.push(p);
    }
    // Lissage (moyenne mobile sur 3 points)
    var smoothed = [];
    for (var i = 0; i < result.length; i++) {
        var s = Object.assign({}, result[i]);
        var sum = result[i].speed, cnt = 1;
        if (i > 0) { sum += result[i - 1].speed; cnt++; }
        if (i < result.length - 1) { sum += result[i + 1].speed; cnt++; }
        s.speed = sum / cnt;
        smoothed.push(s);
    }
    return smoothed;
}

function showPisteDetail(index) {
    var item = timelineData[index];
    if (!item || item.type !== 'descent') return;

    // Zoom sur les tracks de cette piste
    zoomToTracks(item.track_ids);

    // Remplir le panel
    var panel = document.getElementById('piste-detail-panel');
    var badge = document.getElementById('piste-detail-badge');
    var badgeClass = pisteBadgeClass(item.piste_difficulty);
    badge.className = 'piste-badge ' + badgeClass;
    badge.innerHTML = '<span class="dot"></span>' + pisteDifficultyLabel(item.piste_difficulty);

    setText('piste-detail-name', item.piste_name);
    setText('piste-detail-distance', fmt1(item.distance) + ' km');
    setText('piste-detail-elev', fmt0(Math.abs(item.elevation_change)) + ' m');
    setText('piste-detail-duration', formatDuration(item.duration_seconds));
    setText('piste-detail-avg-speed', fmt1(item.avg_speed) + ' km/h');
    setText('piste-detail-max-speed', fmt1(item.max_speed) + ' km/h');

    // Calculer les vitesses par point (distance/temps entre points consecutifs)
    var enrichedPoints = computePointSpeeds(item.points);

    // Afficher le panel AVANT de dessiner (sinon canvas a 0 de largeur)
    panel.classList.remove('hidden');

    // Dessiner les profils
    drawSpeedProfile(enrichedPoints);
    draw3DProfile(enrichedPoints);

    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closePisteDetail() {
    var panel = document.getElementById('piste-detail-panel');
    if (panel) panel.classList.add('hidden');
}

function drawSpeedProfile(points) {
    var canvas = document.getElementById('piste-profile-canvas');
    if (!canvas || !points || points.length < 2) return;

    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;

    // Taille reelle du canvas
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 180 * dpr;
    ctx.scale(dpr, dpr);
    var W = rect.width;
    var H = 180;

    ctx.clearRect(0, 0, W, H);

    // Calculer distance cumulee et bornes
    var cumDist = [0];
    var elevations = [points[0].elevation || 0];
    var speeds = [points[0].speed || 0];

    for (var i = 1; i < points.length; i++) {
        var p0 = points[i - 1], p1 = points[i];
        var dlat = (p1.latitude - p0.latitude) * 111320;
        var dlon = (p1.longitude - p0.longitude) * 111320 * Math.cos(p0.latitude * Math.PI / 180);
        var d = Math.sqrt(dlat * dlat + dlon * dlon);
        cumDist.push(cumDist[cumDist.length - 1] + d);
        elevations.push(p1.elevation || elevations[elevations.length - 1]);
        speeds.push(p1.speed || 0);
    }

    var totalDist = cumDist[cumDist.length - 1];
    if (totalDist === 0) return;

    var minElev = Math.min.apply(null, elevations);
    var maxElev = Math.max.apply(null, elevations);
    var elevRange = maxElev - minElev || 1;

    // Marges
    var pad = { top: 10, bottom: 25, left: 45, right: 10 };
    var gW = W - pad.left - pad.right;
    var gH = H - pad.top - pad.bottom;

    function x(dist) { return pad.left + (dist / totalDist) * gW; }
    function y(elev) { return pad.top + gH - ((elev - minElev) / elevRange) * gH; }

    function speedColor(spd) {
        if (spd < 20) return '#22c55e';
        if (spd < 40) return '#eab308';
        if (spd < 60) return '#f97316';
        return '#ef4444';
    }

    // Fond grise sous le profil
    ctx.beginPath();
    ctx.moveTo(x(0), y(elevations[0]));
    for (var j = 1; j < points.length; j++) {
        ctx.lineTo(x(cumDist[j]), y(elevations[j]));
    }
    ctx.lineTo(x(totalDist), pad.top + gH);
    ctx.lineTo(x(0), pad.top + gH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(148,163,184,0.1)';
    ctx.fill();

    // Profil colore par vitesse
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (var j = 1; j < points.length; j++) {
        ctx.beginPath();
        ctx.moveTo(x(cumDist[j - 1]), y(elevations[j - 1]));
        ctx.lineTo(x(cumDist[j]), y(elevations[j]));
        ctx.strokeStyle = speedColor(speeds[j]);
        ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = 'rgba(161,161,170,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + gH);
    ctx.lineTo(pad.left + gW, pad.top + gH);
    ctx.stroke();

    // Labels altitude (gauche)
    ctx.fillStyle = 'rgba(161,161,170,0.8)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    var nLabels = 4;
    for (var k = 0; k <= nLabels; k++) {
        var elev = minElev + (elevRange * k / nLabels);
        ctx.fillText(Math.round(elev) + 'm', pad.left - 5, y(elev));
    }

    // Labels distance (bas)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var nDist = Math.min(5, Math.floor(totalDist / 100));
    if (nDist < 2) nDist = 2;
    for (var k = 0; k <= nDist; k++) {
        var dd = (totalDist * k / nDist);
        var label = dd >= 1000 ? (dd / 1000).toFixed(1) + 'km' : Math.round(dd) + 'm';
        ctx.fillText(label, x(dd), pad.top + gH + 5);
    }
}

// ---------------------------------------------------------------------------
// Vue 3D du trace
// ---------------------------------------------------------------------------

var _3d_rotation = -0.6; // angle initial (radians)
var _3d_points = null;
var _3d_dragging = false;
var _3d_lastX = 0;

function draw3DProfile(points) {
    var canvas = document.getElementById('piste-3d-canvas');
    if (!canvas || !points || points.length < 2) return;

    _3d_points = points;

    // Initialiser les événements souris une seule fois
    if (!canvas._3dInit) {
        canvas._3dInit = true;
        canvas.addEventListener('mousedown', function(e) {
            _3d_dragging = true;
            _3d_lastX = e.clientX;
            canvas.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', function(e) {
            if (!_3d_dragging) return;
            var dx = e.clientX - _3d_lastX;
            _3d_lastX = e.clientX;
            _3d_rotation += dx * 0.008;
            _render3D(canvas, _3d_points, _3d_rotation);
        });
        window.addEventListener('mouseup', function() {
            _3d_dragging = false;
            canvas.style.cursor = 'grab';
        });
        // Touch
        canvas.addEventListener('touchstart', function(e) {
            _3d_dragging = true;
            _3d_lastX = e.touches[0].clientX;
        }, { passive: true });
        window.addEventListener('touchmove', function(e) {
            if (!_3d_dragging) return;
            var dx = e.touches[0].clientX - _3d_lastX;
            _3d_lastX = e.touches[0].clientX;
            _3d_rotation += dx * 0.008;
            _render3D(canvas, _3d_points, _3d_rotation);
        }, { passive: true });
        window.addEventListener('touchend', function() { _3d_dragging = false; });
    }

    _render3D(canvas, points, _3d_rotation);
}

function _render3D(canvas, points, angle) {
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 280 * dpr;
    ctx.scale(dpr, dpr);
    var W = rect.width, H = 280;

    // Calculer les coordonnées locales en mètres
    var refLat = points[0].latitude;
    var refLon = points[0].longitude;
    var cosLat = Math.cos(refLat * Math.PI / 180);
    var coords = [];
    for (var i = 0; i < points.length; i++) {
        var p = points[i];
        coords.push({
            x: (p.longitude - refLon) * 111320 * cosLat,
            y: (p.latitude - refLat) * 111320,
            z: (p.elevation || 0),
            speed: p.speed || 0
        });
    }

    // Bornes
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (var i = 0; i < coords.length; i++) {
        if (coords[i].x < minX) minX = coords[i].x;
        if (coords[i].x > maxX) maxX = coords[i].x;
        if (coords[i].y < minY) minY = coords[i].y;
        if (coords[i].y > maxY) maxY = coords[i].y;
        if (coords[i].z < minZ) minZ = coords[i].z;
        if (coords[i].z > maxZ) maxZ = coords[i].z;
    }
    var rangeX = maxX - minX || 1;
    var rangeY = maxY - minY || 1;
    var rangeZ = maxZ - minZ || 1;
    var cx = (minX + maxX) / 2;
    var cy = (minY + maxY) / 2;
    var cz = (minZ + maxZ) / 2;

    // Normaliser autour du centre
    var maxRange = Math.max(rangeX, rangeY);
    var norm = [];
    for (var i = 0; i < coords.length; i++) {
        norm.push({
            x: (coords[i].x - cx) / maxRange,
            y: (coords[i].y - cy) / maxRange,
            z: (coords[i].z - cz) / maxRange * 1.5, // exagerer l'altitude
            speed: coords[i].speed
        });
    }

    // Projection isometrique avec rotation
    var cosA = Math.cos(angle);
    var sinA = Math.sin(angle);
    var tilt = 0.55; // inclinaison verticale

    function project(pt) {
        var rx = pt.x * cosA - pt.y * sinA;
        var ry = pt.x * sinA + pt.y * cosA;
        var sx = W / 2 + rx * W * 0.38;
        var sy = H * 0.55 - pt.z * H * 0.35 - ry * H * tilt * 0.25;
        return { x: sx, y: sy };
    }

    function speedColor(spd) {
        if (spd < 20) return '#22c55e';
        if (spd < 40) return '#eab308';
        if (spd < 60) return '#f97316';
        return '#ef4444';
    }

    // Theme
    var isDark = document.documentElement.classList.contains('dark');

    ctx.clearRect(0, 0, W, H);

    // Grille au sol
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 0.5;
    var gridN = 8;
    for (var g = 0; g <= gridN; g++) {
        var t = g / gridN - 0.5;
        var a1 = project({ x: t, y: -0.5, z: (minZ - cz) / maxRange * 1.5 });
        var a2 = project({ x: t, y: 0.5, z: (minZ - cz) / maxRange * 1.5 });
        ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); ctx.stroke();
        var b1 = project({ x: -0.5, y: t, z: (minZ - cz) / maxRange * 1.5 });
        var b2 = project({ x: 0.5, y: t, z: (minZ - cz) / maxRange * 1.5 });
        ctx.beginPath(); ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
    }

    // Ombre du trace au sol
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    for (var i = 0; i < norm.length; i++) {
        var p = project({ x: norm[i].x, y: norm[i].y, z: (minZ - cz) / maxRange * 1.5 });
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // Piliers au debut et fin
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    [0, norm.length - 1].forEach(function(idx) {
        var top = project(norm[idx]);
        var bot = project({ x: norm[idx].x, y: norm[idx].y, z: (minZ - cz) / maxRange * 1.5 });
        ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bot.x, bot.y); ctx.stroke();
    });
    ctx.setLineDash([]);

    // Trace 3D colore par vitesse
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (var i = 1; i < norm.length; i++) {
        var p0 = project(norm[i - 1]);
        var p1 = project(norm[i]);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = speedColor(norm[i].speed);
        ctx.stroke();
    }

    // Points debut/fin
    var startP = project(norm[0]);
    var endP = project(norm[norm.length - 1]);
    ctx.fillStyle = '#22c55e';
    ctx.beginPath(); ctx.arc(startP.x, startP.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(endP.x, endP.y, 5, 0, Math.PI * 2); ctx.fill();

    // Labels altitude
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
    ctx.textAlign = 'left';
    ctx.fillText(Math.round(coords[0].z) + 'm', startP.x + 8, startP.y - 2);
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(coords[coords.length - 1].z) + 'm', endP.x - 8, endP.y - 2);

    // Instruction rotation
    ctx.textAlign = 'center';
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText('Glisser pour tourner', W / 2, H - 8);
}

// ---------------------------------------------------------------------------
// Upload GPX
// ---------------------------------------------------------------------------

var selectedFile = null;

function initUpload() {
    var dropZone = document.getElementById('drop-zone');
    var fileInput = document.getElementById('file-input');
    if (!dropZone || !fileInput) return;

    ['dragenter', 'dragover'].forEach(function(evt) {
        dropZone.addEventListener(evt, function(e) {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(function(evt) {
        dropZone.addEventListener(evt, function(e) {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        });
    });

    dropZone.addEventListener('drop', function(e) {
        var files = e.dataTransfer.files;
        if (files.length > 0 && files[0].name.toLowerCase().endsWith('.gpx')) {
            selectFile(files[0]);
        } else {
            showToast('Veuillez deposer un fichier .gpx', 'warning');
        }
    });

    fileInput.addEventListener('change', function() {
        if (fileInput.files.length > 0) selectFile(fileInput.files[0]);
    });

    var clearBtn = document.getElementById('file-clear');
    if (clearBtn) clearBtn.addEventListener('click', clearFile);
}

function selectFile(file) {
    selectedFile = file;
    document.getElementById('file-info').classList.remove('hidden');
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('upload-btn').classList.remove('hidden');
    document.getElementById('upload-btn').disabled = false;
}

function clearFile() {
    selectedFile = null;
    document.getElementById('file-input').value = '';
    document.getElementById('file-info').classList.add('hidden');
    document.getElementById('upload-btn').classList.add('hidden');
    document.getElementById('upload-progress').classList.add('hidden');
}

async function uploadGPX() {
    if (!selectedFile) return;

    var uploadBtn = document.getElementById('upload-btn');
    var progressDiv = document.getElementById('upload-progress');
    var progressBar = document.getElementById('progress-bar');
    var progressPct = document.getElementById('progress-percent');

    uploadBtn.disabled = true;
    progressDiv.classList.remove('hidden');

    var formData = new FormData();
    formData.append('file', selectedFile);

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.addEventListener('progress', function(e) {
        if (e.lengthComputable) {
            var pct = Math.round((e.loaded / e.total) * 100);
            progressBar.style.width = pct + '%';
            progressPct.textContent = pct + '%';
        }
    });

    xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
            var data = {};
            try { data = JSON.parse(xhr.responseText); } catch (e) {}
            var msg = 'Import reussi';
            if (data.new_points > 0) msg += ' : ' + data.new_points + ' nouveaux points';
            if (data.days_updated) msg += ' sur ' + data.days_updated + ' jour(s)';
            showToast(msg);
            clearFile();
            sessionsCache = null;
            availableDates = [];
            loadGlobalStats();
            loadDaysList();
        } else {
            var err = 'Erreur lors de l\'import';
            try {
                var body = JSON.parse(xhr.responseText);
                if (body.error) err = body.error;
            } catch (e) {}
            showToast(err, 'error');
            uploadBtn.disabled = false;
        }
        progressDiv.classList.add('hidden');
        progressBar.style.width = '0%';
    };

    xhr.onerror = function() {
        showToast('Erreur reseau', 'error');
        uploadBtn.disabled = false;
        progressDiv.classList.add('hidden');
    };

    xhr.send(formData);
}
