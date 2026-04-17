import os

output_dir = os.path.join("public", "cards")
if not os.path.exists(output_dir):
    os.makedirs(output_dir)

suits = {
    's': {'symbol': '♠', 'color': '#000000'},
    'h': {'symbol': '♥', 'color': '#D40000'},
    'c': {'symbol': '♣', 'color': '#000000'},
    'd': {'symbol': '♦', 'color': '#D40000'}
}
ranks = ['6', '7', '8', '9', '10', 'j', 'q', 'k', 'a']

# Function-kan wuxuu nidaamiyaa calaamadaha dhexda
def get_pips(rank):
    pips = {
        '6': [(90, 160), (210, 160), (90, 240), (210, 240), (90, 320), (210, 320)],
        '7': [(90, 160), (210, 160), (90, 240), (210, 240), (90, 320), (210, 320), (150, 200)],
        '8': [(90, 160), (210, 160), (90, 240), (210, 240), (90, 320), (210, 320), (150, 200), (150, 280)],
        '9': [(90, 150), (210, 150), (90, 215), (210, 215), (90, 280), (210, 280), (90, 345), (210, 345), (150, 247)],
        '10': [(90, 145), (210, 145), (90, 210), (210, 210), (90, 275), (210, 275), (90, 340), (210, 340), (150, 180), (150, 305)]
    }
    return pips.get(rank, [(150, 260)])

# Function loogu talagalay sawirada Boqortooyada
def get_royal_image(rank):
    royals = {
        'j': '🤵', # Jack
        'q': '👸', # Queen
        'k': '🤴', # King
        'a': '🌟'  # Ace
    }
    return royals.get(rank, None)

print("--- Bilaabashada abuurista kaararka casriga ah ---")

for s_key, s_val in suits.items():
    for r in ranks:
        filename = f"{r}{s_key}.svg"
        full_path = os.path.join(output_dir, filename)
        rank_display = r.upper()
        symbol = s_val['symbol']
        color = s_val['color']
        
        # 1. Geesaha (Corners)
        corners = f"""
            <g fill="{color}">
                <text x="20" y="50" font-size="45" font-weight="bold" font-family="Arial">{rank_display}</text>
                <text x="20" y="90" font-size="35" font-family="Arial">{symbol}</text>
            </g>
            <g fill="{color}" transform="rotate(180, 150, 225)">
                <text x="20" y="50" font-size="45" font-weight="bold" font-family="Arial">{rank_display}</text>
                <text x="20" y="90" font-size="35" font-family="Arial">{symbol}</text>
            </g>"""

        # 2. Dhexda (Pips vs Royal)
        pip_elements = ""
        royal_icon = get_royal_image(r)
        
        if royal_icon:
            # Haddii ay tahay J, Q, K, A, dhig emoji weyn
            pip_elements = f'<text x="150" y="270" font-size="180" text-anchor="middle">{royal_icon}</text>'
        else:
            # Haddii ay tahay lambar (6-10), dhig calaamadaha dhexda
            pip_list = get_pips(r)
            for (px, py) in pip_list:
                pip_elements += f'<text x="{px}" y="{py}" font-size="65" text-anchor="middle" fill="{color}">{symbol}</text>\n'

        # 3. Isku darka SVG
        svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
            <rect width="294" height="444" x="3" y="3" rx="20" ry="20" fill="white" stroke="#333" stroke-width="3" />
            {corners}
            {pip_elements}
        </svg>"""

        with open(full_path, "w", encoding="utf-8") as f:
            f.write(svg_content)

print(f"--- Shaqadu waa dhammaatay! ---")