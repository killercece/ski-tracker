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
    var pistesLayer = L.layerGroup();
    var overlays = {
        'Pistes OSM': pistesLayer,
        'Descentes': L.layerGroup(),
        'Remontees': L.layerGroup(),
        'Pauses': L.layerGroup()
    };

    var defaultColors = { descent: '#ef4444', lift: '#3b82f6', pause: '#9ca3af' };
    var labels = { descent: 'Descente', lift: 'Remontee', pause: 'Pause' };
    var layerNames = { descent: 'Descentes', lift: 'Remontees', pause: 'Pauses' };

    var descentCounter = 0;
    tracks.forEach(function(track) {
        if (track.segment_type === 'descent') {
            descentCounter++;
            track.descent_number = descentCounter;
        }
        if (!track.points || track.points.length < 2) return;

        var latlngs = track.points.map(function(p) { return [p.latitude, p.longitude]; });

        // Couleur selon la difficulte de la piste matchee
        var color = defaultColors[track.segment_type] || '#9ca3af';
        var opacity = 0.85;
        if (track.segment_type === 'descent') {
            if (track.piste_difficulty) {
                color = pisteColor(track.piste_difficulty);
                if (track.piste_difficulty === 'expert') {
                    color = '#18181b';
                }
            } else {
                color = '#9ca3af';
                opacity = 0.5;
            }
        }

        var polyline = L.polyline(latlngs, {
            color: color, weight: 4, opacity: opacity
        });

        var popupContent = '<div style="font-family: Inter, sans-serif; font-size: 13px; line-height: 1.5;">' +
            '<strong>' + (labels[track.segment_type] || track.segment_type) + '</strong>';
        if (track.segment_type === 'descent') popupContent += ' #' + track.descent_number;
        if (track.piste_name) {
            popupContent += '<br>Piste : <strong>' + track.piste_name + '</strong>';
            if (track.piste_difficulty) popupContent += ' (' + pisteDifficultyLabel(track.piste_difficulty) + ')';
        } else if (track.piste_difficulty) {
            popupContent += '<br>Piste : ' + pisteDifficultyLabel(track.piste_difficulty);
        }
        popupContent += '<br>Distance : ' + fmt1(track.distance) + ' km<br>' +
            'Denivele : ' + fmt0(Math.abs(track.elevation_change)) + ' m<br>' +
            'Duree : ' + formatDuration(track.duration_seconds) + '<br>' +
            'Vit. moy : ' + fmt1(track.avg_speed) + ' km/h';
        if (track.segment_type === 'descent') {
            popupContent += '<br>Vit. max : ' + fmt1(track.max_speed) + ' km/h';
        }
        if (track.match_confidence) {
            popupContent += '<br><span style="color:#888;">Confiance : ' + Math.round(track.match_confidence * 100) + '%</span>';
        }
        popupContent += '</div>';
        polyline.bindPopup(popupContent);

        dayTrackLayers[track.id] = polyline;

        var layerName = layerNames[track.segment_type];
        if (overlays[layerName]) polyline.addTo(overlays[layerName]);

        latlngs.forEach(function(ll) { allBounds.push(ll); });
    });

    Object.keys(overlays).forEach(function(name) {
        if (name !== 'Pistes OSM') overlays[name].addTo(dayMap);
    });
    pistesLayer.addTo(dayMap);

    if (allBounds.length > 0) {
        var startIcon = L.divIcon({
            html: '<div style="width:14px;height:14px;background:#22c55e;border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>',
            iconSize: [14, 14], iconAnchor: [7, 7], className: ''
        });
        L.marker(allBounds[0], { icon: startIcon, title: 'Depart' }).bindPopup('Depart').addTo(dayMap);

        var endIcon = L.divIcon({
            html: '<div style="width:14px;height:14px;background:#ef4444;border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>',
            iconSize: [14, 14], iconAnchor: [7, 7], className: ''
        });
        L.marker(allBounds[allBounds.length - 1], { icon: endIcon, title: 'Arrivee' }).bindPopup('Arrivee').addTo(dayMap);

        dayMap.fitBounds(allBounds, { padding: [30, 30] });
    }

    L.control.layers(null, overlays, { collapsed: false }).addTo(dayMap);

    // Charger les pistes OSM en arriere-plan
    if (sessionId) {
        loadPistesLayer(sessionId, pistesLayer);
    }
}

async function loadPistesLayer(sessionId, pistesLayer) {
    try {
        var pistes = await api('/api/sessions/' + sessionId + '/pistes');
        if (!pistes || pistes.length === 0) return;

        pistes.forEach(function(piste) {
            if (!piste.geometry || piste.geometry.length < 2) return;

            var latlngs = piste.geometry.map(function(p) { return [p[0], p[1]]; });
            var color = pisteColor(piste.difficulty);

            var polyline = L.polyline(latlngs, {
                color: color,
                weight: 6,
                opacity: 0.25,
                dashArray: '8 6'
            });

            var name = piste.name || 'Sans nom';
            polyline.bindPopup(
                '<div style="font-family: Inter, sans-serif; font-size: 13px;">' +
                '<strong>' + name + '</strong><br>' +
                'Difficulte : ' + pisteDifficultyLabel(piste.difficulty) +
                '</div>'
            );

            polyline.addTo(pistesLayer);
        });
    } catch (e) {
        // Silencieux si les pistes ne chargent pas
    }
}

// ---------------------------------------------------------------------------
// Vue jour : Tableau des descentes
// ---------------------------------------------------------------------------

function renderDayDescentsTable(tracks) {
    var tbody = document.getElementById('day-descents-table');
    var emptyEl = document.getElementById('day-descents-empty');
    if (!tbody) return;

    var descents = tracks.filter(function(t) { return t.segment_type === 'descent'; });

    if (descents.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    tbody.innerHTML = descents.map(function(d, i) {
        var isUnmatched = !d.piste_name && !d.piste_difficulty;
        var rowClass = isUnmatched ? ' class="unmatched-row"' : '';
        var pisteBadge = '';
        if (d.piste_name) {
            var badgeClass = pisteBadgeClass(d.piste_difficulty);
            pisteBadge = '<span class="piste-badge ' + badgeClass + '"><span class="dot"></span>' + d.piste_name + '</span>';
        } else if (d.piste_difficulty) {
            var badgeClass = pisteBadgeClass(d.piste_difficulty);
            pisteBadge = '<span class="piste-badge ' + badgeClass + '"><span class="dot"></span>' + pisteDifficultyLabel(d.piste_difficulty) + '</span>';
        } else {
            pisteBadge = '<span class="text-zinc-400 dark:text-zinc-600 text-xs">&mdash;</span>';
        }

        return '<tr onclick="zoomToDayTrack(' + d.id + ')"' + rowClass + '>' +
            '<td class="px-4 py-3 font-medium">' + (i + 1) + '</td>' +
            '<td class="px-4 py-3">' + pisteBadge + '</td>' +
            '<td class="px-4 py-3 text-zinc-500 dark:text-zinc-400">' + formatTime(d.start_time) + '</td>' +
            '<td class="px-4 py-3">' + formatDuration(d.duration_seconds) + '</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' + fmt1(d.distance) + ' km</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' + fmt0(Math.abs(d.elevation_change)) + ' m</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' + fmt1(d.avg_speed) + ' km/h</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' + fmt1(d.max_speed) + ' km/h</td>' +
        '</tr>';
    }).join('');
}

function zoomToDayTrack(trackId) {
    var layer = dayTrackLayers[trackId];
    if (layer && dayMap) {
        dayMap.fitBounds(layer.getBounds(), { padding: [50, 50], maxZoom: 16 });
        layer.openPopup();
    }
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
