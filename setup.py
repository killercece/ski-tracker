"""
Script d'initialisation de la base de données ski-tracker.
Crée les tables, index et dossiers nécessaires.
"""

import sqlite3
import os
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DATABASE_PATH = os.environ.get('DATABASE_PATH', 'data/ski-tracker.db')
UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', 'data/uploads')


def setup():
    """Initialise la base de données et les dossiers nécessaires."""

    # Création des dossiers
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    logger.info("Dossiers créés : %s, %s", os.path.dirname(DATABASE_PATH), UPLOAD_FOLDER)

    # Connexion et création des tables
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            date TEXT NOT NULL,
            user_id INTEGER REFERENCES users(id),
            total_distance REAL DEFAULT 0,
            total_elevation_gain REAL DEFAULT 0,
            total_elevation_loss REAL DEFAULT 0,
            max_speed REAL DEFAULT 0,
            avg_speed REAL DEFAULT 0,
            num_descents INTEGER DEFAULT 0,
            duration_seconds INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            segment_type TEXT NOT NULL CHECK(segment_type IN ('descent', 'lift', 'pause')),
            start_time TEXT,
            end_time TEXT,
            distance REAL DEFAULT 0,
            elevation_change REAL DEFAULT 0,
            avg_speed REAL DEFAULT 0,
            max_speed REAL DEFAULT 0,
            duration_seconds INTEGER DEFAULT 0,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS track_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            elevation REAL,
            time TEXT,
            speed REAL,
            point_order INTEGER NOT NULL,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tracks_session ON tracks(session_id);
        CREATE INDEX IF NOT EXISTS idx_points_track ON track_points(track_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

        CREATE TABLE IF NOT EXISTS osm_pistes (
            osm_id INTEGER PRIMARY KEY,
            name TEXT,
            difficulty TEXT,
            geometry TEXT,
            bbox_min_lat REAL, bbox_max_lat REAL,
            bbox_min_lon REAL, bbox_max_lon REAL,
            fetched_at TEXT
        );
        CREATE TABLE IF NOT EXISTS osm_fetch_zones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            min_lat REAL, max_lat REAL,
            min_lon REAL, max_lon REAL,
            fetched_at TEXT
        );
    """)

    # Migration : ajouter user_id si manquant (installations existantes)
    cols = [row[1] for row in cursor.execute("PRAGMA table_info(sessions)").fetchall()]
    if 'user_id' not in cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN user_id INTEGER REFERENCES users(id)")
        logger.info("Migration : colonne user_id ajoutée à la table sessions")

    # Migration : colonnes piste matching sur tracks
    track_cols = [row[1] for row in cursor.execute("PRAGMA table_info(tracks)").fetchall()]
    if 'piste_osm_id' not in track_cols:
        cursor.execute("ALTER TABLE tracks ADD COLUMN piste_osm_id INTEGER")
        cursor.execute("ALTER TABLE tracks ADD COLUMN piste_name TEXT")
        cursor.execute("ALTER TABLE tracks ADD COLUMN piste_difficulty TEXT")
        cursor.execute("ALTER TABLE tracks ADD COLUMN match_confidence REAL")
        logger.info("Migration : colonnes piste matching ajoutées à tracks")

    conn.commit()
    conn.close()
    logger.info("Base de données initialisée : %s", DATABASE_PATH)


if __name__ == '__main__':
    setup()
