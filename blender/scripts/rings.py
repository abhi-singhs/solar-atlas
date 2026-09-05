"""Mean ring dimensions from NASA PDS and the Chariklo discovery paper."""

# Name, inner radius km, outer radius km, representative normal optical depth.
RINGS = {
    "jupiter": [
        ("Main ring", 122400, 129100, 0.000008),
        ("Amalthea gossamer", 122400, 181350, 0.0000005),
        ("Thebe gossamer", 122400, 221900, 0.0000001),
    ],
    "saturn": [
        ("D ring", 66900, 74491, 0.0001),
        ("C ring inner", 74491, 77748, 0.15),
        ("C ring middle", 77926, 87343, 0.15),
        ("C ring outer", 87610, 91975, 0.15),
        ("B ring", 91975, 117570, 2.0),
        ("Cassini division", 117570, 122050, 0.05),
        ("A ring inner", 122050, 133423, 0.6),
        ("A ring beyond Encke", 133745, 136487, 0.6),
        ("A ring beyond Keeler", 136522, 136770, 0.6),
        ("F ring", 139826, 140612, 0.06),
        ("G ring", 166000, 173200, 0.000001),
        ("E ring", 180000, 480000, 0.000005),
    ],
    "uranus": [
        ("Zeta", 37850, 41350, 0.0045),
        ("Six", 41838 - 1.53 / 2, 41838 + 1.53 / 2, 0.3),
        ("Five", 42234 - 2.28 / 2, 42234 + 2.28 / 2, 0.5),
        ("Four", 42571 - 2.33 / 2, 42571 + 2.33 / 2, 0.3),
        ("Alpha", 44718 - 8.46 / 2, 44718 + 8.46 / 2, 0.4),
        ("Beta", 45661 - 9.49 / 2, 45661 + 9.49 / 2, 0.3),
        ("Eta", 47176 - 1.6 / 2, 47176 + 1.6 / 2, 0.4),
        ("Gamma", 47627 - 2.15 / 2, 47627 + 2.15 / 2, 0.3),
        ("Delta", 48300 - 4.6 / 2, 48300 + 4.6 / 2, 0.5),
        ("Lambda", 50024 - 2.3 / 2, 50024 + 2.3 / 2, 0.1),
        ("Epsilon", 51149 - 58.1 / 2, 51149 + 58.1 / 2, 1.2),
        ("Nu", 65400, 69200, 0.0000056),
        ("Mu", 89200, 106200, 0.0000085),
    ],
    "neptune": [
        ("Galle", 41000, 43000, 0.0001),
        ("Le Verrier, width upper limit", 53150, 53250, 0.003),
        ("Lassell", 53200, 57200, 0.0001),
        ("Adams, azimuthal mean", 62925.5, 62940.5, 0.01),
    ],
    "chariklo": [
        ("C1R", 390.6 - 6.6 / 2, 390.6 + 6.6 / 2, 0.4),
        ("C2R", 404.8 - 3.4 / 2, 404.8 + 3.4 / 2, 0.06),
    ],
    "haumea": [
        ("Ring", 2287 - 70 / 2, 2287 + 70 / 2, 0.5),
    ],
    "quaoar": [
        ("Q1R, narrow-component approximation", 4057.2 - 5 / 2, 4057.2 + 5 / 2, 0.4),
        ("Q2R", 2520 - 10 / 2, 2520 + 10 / 2, 0.004),
    ],
}

RING_POLES = {"chariklo": (151.30, 41.48), "haumea": (285.1, -10.6),
              "quaoar": (259.82, 53.45)}

RING_NOTES = {
    planet: (
        f"https://pds-rings.seti.org/{planet}/{planet}_rings_table.html . "
        "Mean radii and representative optical depths, not a complete particle model. "
        "Circular, zero-thickness optical sheets omit eccentricity, vertical structure, "
        "dust phase functions, and time-dependent arcs."
    )
    for planet in ("jupiter", "saturn", "uranus", "neptune")
}
RING_NOTES["chariklo"] = (
    "Braga-Ribas et al. 2014, https://arxiv.org/abs/1409.7259 . "
    "Preferred equatorial J2000 pole RA 151.30 deg, DEC 41.48 deg. "
    "Mean circular sheets; representative widths and optical depths."
)
RING_NOTES["haumea"] = (
    "Ortiz et al. 2017 parameters, reproduced by Mueller et al. 2018, "
    "https://arxiv.org/abs/1811.09476 . Equatorial pole RA 285.1 deg, DEC -10.6 deg; "
    "radius 2287 km, width 70 km, normal optical depth 0.5."
)
RING_NOTES["quaoar"] = (
    "Pereira et al. 2023, https://arxiv.org/abs/2304.09237 , Table 2. "
    "Preferred ICRS pole RA 259.82 deg, DEC 53.45 deg. Q1R varies azimuthally; "
    "this sheet uses its narrow component's representative 5 km width and 0.4 peak depth, "
    "not an observed uniform global profile. Q2R is assumed coplanar; radius uncertainty 20 km."
)
