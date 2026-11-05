# Adding products and photos

There are two ways to add products. Both are under **Products** in the team dashboard.

## One at a time

Press **Add a product**, then fill in its details, sizes, options such as ribbon color or a card
message, how it can be received, and its photos. This suits a handful of products, and anything
with special options.

## Many at once, from a spreadsheet

1. On the **Products** page, under **From a spreadsheet**, press **Download the template**.
2. Open it in Excel, Numbers or Google Sheets. It has three example rows. Replace them with your own.
3. Save or export it as **CSV**.
4. Back on the **Products** page, choose the file and press **Check the file**.
5. If anything needs fixing, the page lists each problem with its line number, and nothing is imported. Fix the spreadsheet and check again.
6. When the check passes, press **Import**.

Imported products arrive as **drafts**, so customers do not see them yet. Open each one to add
photos and options, then set it to **Active**.

### The columns

One row per size or variant. Rows with the same name become one product with several sizes.

| Column | Required | What to enter |
| --- | --- | --- |
| name | Yes | The product name |
| department | Yes | Floral, Boutique, or another department you have set up |
| category | | Such as Bouquets. Created for you if it does not exist yet |
| variant | Yes | The size or option name, such as Standard, Small, or A dozen |
| sku | Yes | Your own stock code. Each one must be different |
| price | Yes | In dollars, such as 65 or 65.00 |
| sale_price | | A lower price while on sale |
| cost | | What it costs you, for your reports only. Customers never see it |
| stock | | How many you have. Leave blank for made-to-order flowers |
| low_stock_alert | | Get an alert when stock falls to this number |
| prep_minutes | | Minutes of work to prepare one |
| workload_points | | How much of a day it uses: a small bouquet might be 1, a large piece 5 |
| min_notice_hours | | Hours of notice needed |
| pickup, delivery, shipping | | yes or no |
| tax_category | | From your sales tax settings. Blank means standard |
| short_description | | One line for the shop listing |
| description | | The full description |
| status | | draft or active. Blank means draft |

The import refuses a file with a duplicate stock code, a product name that already exists, a
department that does not exist, or a price that is not a number. It never half-imports a file.

## Photos

- Use photos of your own work. The demonstration uses licensed stock photos, which must be replaced.
- JPEG, PNG or WebP, up to 10 MB each. They are resized and compressed for the web automatically, and location data is removed.
- The first photo is the one shown in the shop.
- Good photos are bright, in focus, and show the piece against a plain background.

## After importing

- Add options, such as card messages or ribbon colors, on each product.
- For flowers whose stock you track by stem, add a **recipe**, so stock goes down as orders are made.
- Set seasonal dates for products that are only available part of the year.
- Remove the demonstration products before going live. The launch checklist will remind you.
