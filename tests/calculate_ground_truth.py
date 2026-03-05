import csv
import json

CSV_PATH = r"tests/Crystal Clean Car Care - Search Term Analysis - Sponsored_Products_Search_term_.csv"

def parse_dollar(val):
    if not val or not val.strip():
        return 0.0
    val = val.strip().replace('$', '').replace(',', '')
    try:
        return float(val)
    except ValueError:
        return 0.0

def parse_int_safe(val):
    if not val or not val.strip():
        return 0
    try:
        return int(float(val.strip()))
    except ValueError:
        return 0

rows = []
with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for row in reader:
        rows.append(row)

print(f"Total rows: {len(rows)}")

total_spend = 0.0
total_sales = 0.0
wasted_spend = 0.0
campaign_data = {}

for row in rows:
    spend = parse_dollar(row.get('Spend', ''))
    sales = parse_dollar(row.get('7 Day Total Sales ', ''))
    orders = parse_int_safe(row.get('7 Day Total Orders (#)', ''))
    clicks = parse_int_safe(row.get('Clicks', ''))
    campaign = row.get('Campaign Name', '').strip()

    total_spend += spend
    total_sales += sales

    if orders == 0:
        wasted_spend += spend

    if campaign not in campaign_data:
        campaign_data[campaign] = {'spend': 0.0, 'sales': 0.0, 'orders': 0, 'clicks': 0}
    campaign_data[campaign]['spend'] += spend
    campaign_data[campaign]['sales'] += sales
    campaign_data[campaign]['orders'] += orders
    campaign_data[campaign]['clicks'] += clicks

current_acos = round(total_spend / total_sales * 100, 1) if total_sales > 0 else 0
wasted_spend_30 = round(wasted_spend)
weekly_ad_spend = round(total_spend / 4)
weekly_sales = round(total_sales / 4)
total_spend_rounded = round(total_spend, 2)
total_sales_rounded = round(total_sales, 2)

# Low performer: campaign ACOS > 45% OR (clicks > 5 AND orders = 0)
# Campaigns with spend > 0 and sales = 0 have effectively infinite ACOS -> > 45%
low_performer_count = 0
low_performers = []
for campaign, data in sorted(campaign_data.items()):
    if data['sales'] > 0:
        camp_acos = data['spend'] / data['sales'] * 100
    elif data['spend'] > 0:
        camp_acos = float('inf')  # spent money with no sales = infinite ACOS
    else:
        camp_acos = 0  # no spend, no sales

    is_high_acos = camp_acos > 45
    is_no_orders_high_clicks = data['clicks'] > 5 and data['orders'] == 0

    if is_high_acos or is_no_orders_high_clicks:
        low_performer_count += 1
        low_performers.append({
            'name': campaign,
            'spend': round(data['spend'], 2),
            'sales': round(data['sales'], 2),
            'orders': data['orders'],
            'clicks': data['clicks'],
            'acos': round(camp_acos, 2) if camp_acos != float('inf') else 'inf',
            'reason': ('high_acos' if is_high_acos else '') + (' no_orders_high_clicks' if is_no_orders_high_clicks else '')
        })

print(f"\n=== CALCULATED METRICS ===")
print(f"currentAcos: {current_acos}")
print(f"wastedSpend30Days: {wasted_spend_30} (raw: {round(wasted_spend, 2)})")
print(f"lowPerformerCount: {low_performer_count}")
print(f"weeklyAdSpend: {weekly_ad_spend}")
print(f"weeklySales: {weekly_sales}")
print(f"totalSpend: {total_spend_rounded}")
print(f"totalSales: {total_sales_rounded}")

expected = {
    'currentAcos': 57.4,
    'wastedSpend30Days': 1535,
    'lowPerformerCount': 33,
    'weeklyAdSpend': 1243,
    'weeklySales': 2165,
    'totalSpend': 4973.95,
    'totalSales': 8659.45
}

calculated = {
    'currentAcos': current_acos,
    'wastedSpend30Days': wasted_spend_30,
    'lowPerformerCount': low_performer_count,
    'weeklyAdSpend': weekly_ad_spend,
    'weeklySales': weekly_sales,
    'totalSpend': total_spend_rounded,
    'totalSales': total_sales_rounded
}

print(f"\n=== COMPARISON ===")
for key in expected:
    match = "MATCH" if calculated[key] == expected[key] else "MISMATCH"
    print(f"{key}: calculated={calculated[key]}, expected={expected[key]} -> {match}")

print(f"\nTotal unique campaigns: {len(campaign_data)}")
print(f"\n=== LOW PERFORMER CAMPAIGNS ({low_performer_count}) ===")
for c in low_performers:
    print(f"  {c['name']}: ACOS={c['acos']}%, clicks={c['clicks']}, orders={c['orders']}, spend={c['spend']}, sales={c['sales']}, reason={c['reason']}")

# Also print all campaigns that are NOT low performers for investigation
print(f"\n=== NON-LOW-PERFORMER CAMPAIGNS ===")
for campaign, data in sorted(campaign_data.items()):
    if data['sales'] > 0:
        camp_acos = data['spend'] / data['sales'] * 100
    elif data['spend'] > 0:
        camp_acos = float('inf')
    else:
        camp_acos = 0
    is_high_acos = camp_acos > 45
    is_no_orders_high_clicks = data['clicks'] > 5 and data['orders'] == 0
    if not (is_high_acos or is_no_orders_high_clicks):
        print(f"  {campaign}: ACOS={round(camp_acos,2) if camp_acos != float('inf') else 'inf'}%, clicks={data['clicks']}, orders={data['orders']}, spend={round(data['spend'],2)}, sales={round(data['sales'],2)}")

# Write ground truth
with open('tests/GROUND_TRUTH.json', 'w') as f:
    json.dump(calculated, f, indent=2)

print(f"\nGROUND_TRUTH.json written.")
