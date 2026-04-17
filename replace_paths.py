import os

# 1. Meesha uu yaallo index.html
file_path = os.path.join("public", "index.html")

if not os.path.exists(file_path):
    print("Khalad: index.html laguma dhex arkin folder-ka public!")
else:
    # 2. Akhri koodhka hadda jira
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 3. Samee beddelka (Replace)
    # Tusaale: ka beddel '7s.png' una beddel 'cards/7s.svg'
    # Waxaan sidoo kale hubinaynaa in xarfaha waaweyn (As.png) ay noqdaan yaryar (as.svg)
    
    import re
    
    # Habkani wuxuu raadinayaa magac kasta oo ku dhammaada .png
    # wuxuuna u beddelayaa cards/magaca.svg (isagoo ka dhigaya xarfo yaryar)
    def fix_path(match):
        filename = match.group(1).lower()
        return f'src="cards/{filename}.svg"'

    # Waxaan raadinaynaa src="Hebel.png"
    new_content = re.sub(r'src="([^"]+)\.png"', fix_path, content)

    # 4. Dib ugu qor faylka
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)

    print("Guul! index.html waa la cusboonaysiiyey.")
    print("Dhammaan .png waxaa loo beddeley .svg, folder-ka 'cards/' na waa lagu daray.")