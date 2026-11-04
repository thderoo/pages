#!/usr/bin/env python3
"""
scryfall-artists-split.py : découpe un dataset scryfall-artists en fichiers
servis par site/scryfall-artists.html.

Usage (depuis projects/pages/) :
    python3 tools/scryfall-artists-split.py <dataset.json> site/scryfall-artists/

Écrit dans le dossier de sortie :
  index.json     : artistes (compteurs, années, aperçu de 3 illustrations
                   complètes, numéro de paquet `shard`), JSON compact ;
  works/<n>.json : paquets de 50 artistes triés par nom normalisé,
                   {artist_id: [works...]}, n = 0, 1, 2...

Python 3, bibliothèque standard uniquement. Les anciens works/*.json du
dossier de sortie sont supprimés avant écriture.
"""

import json
import sys
import unicodedata
from pathlib import Path

SHARD_SIZE = 50


def fold(text):
    """Nom normalisé pour le tri et la recherche : sans accents, en minuscules."""
    decomposed = unicodedata.normalize("NFD", text)
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return stripped.casefold()


def split(dataset, out_dir):
    works_dir = out_dir / "works"
    works_dir.mkdir(parents=True, exist_ok=True)
    for old in works_dir.glob("*.json"):
        old.unlink()

    artists = sorted(dataset["artists"], key=lambda a: (fold(a["name"]), a["id"]))
    index_artists = []
    for shard_no, start in enumerate(range(0, len(artists), SHARD_SIZE)):
        shard_artists = artists[start:start + SHARD_SIZE]
        shard_data = {}
        for artist in shard_artists:
            works = artist["works"]
            shard_data[artist["id"]] = works
            by_illustration = {w["illustration_id"]: w for w in works}
            preview = [by_illustration[i] for i in artist["preview"]]
            index_artists.append({
                "id": artist["id"],
                "name": artist["name"],
                "illustrations": artist["illustrations"],
                "printings": artist["printings"],
                "cards": artist["cards"],
                "alt_illustrations": artist["alt_illustrations"],
                "first_year": artist["first_year"],
                "last_year": artist["last_year"],
                "shard": shard_no,
                "preview": preview,
            })
        write_json(works_dir / f"{shard_no}.json", shard_data)

    index = {
        "generated_at": dataset["generated_at"],
        "source": dataset["source"],
        "artists": index_artists,
    }
    write_json(out_dir / "index.json", index)
    return len(index_artists), len(artists) // SHARD_SIZE + (len(artists) % SHARD_SIZE > 0)


def write_json(path, obj):
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")


def main(argv):
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    dataset_path, out_dir = Path(argv[1]), Path(argv[2])
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    n_artists, n_shards = split(dataset, out_dir)
    print(f"{n_artists} artists, {n_shards} shards -> {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
