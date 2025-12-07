# Price Monitoring Feature

## Overview

This feature automatically monitors the purchase prices of products when expenses are recorded and suggests selling price updates based on cost price changes and markup percentages. When you record an expense for a product that already exists in your inventory, the system:

1. **Detects** if the purchase price has changed significantly (more than 1%)
2. **Calculates** a suggested selling price based on your markup percentage
3. **Prompts** you to update the product's cost price and/or selling price

## How It Works

### 1. Database Changes

#### Product Model
- Added `cost_price` field: The purchase/cost price per unit
- Added `markup_percentage` field: The markup percentage used to calculate selling price from cost

#### Expense Model
- Added `product_id` field: Links expenses to products (optional)
- Added `cost_per_unit` field: Automatically calculated as `amount / quantity`

### 2. Automatic Product Matching

When you create an expense, the system automatically tries to match it to an existing product:
1. First, it checks if `product_id` is provided
2. If not, it matches by `product_name` (case-insensitive)
3. If a match is found, the expense is linked to the product

### 3. Price Change Detection

When creating an expense for a matched product:
- The system calculates the cost per unit from the expense (`amount / quantity`)
- Compares it with the product's existing `cost_price`
- If the difference is more than 1%, it flags a price change
- Calculates a suggested selling price: `new_cost_price * (1 + markup_percentage / 100)`

### 4. Price Suggestion Response

When a price change is detected, the API response includes a `priceSuggestion` object:

```json
{
  "success": true,
  "data": { /* expense data */ },
  "priceSuggestion": {
    "hasPriceChange": true,
    "product": {
      "id": "product_id",
      "name": "Product Name",
      "sku": "SKU-001"
    },
    "currentCostPrice": 10.00,
    "newCostPrice": 12.50,
    "currentSellingPrice": 15.00,
    "suggestedSellingPrice": 18.75,
    "markupPercentage": 50,
    "priceChangePercentage": 25.00,
    "message": "Cost price for 'Product Name' has increased from 10.00 to 12.50 (25.00% increased)..."
  }
}
```

## API Usage

### Creating an Expense (with Price Monitoring)

**Endpoint:** `POST /api/v1/expenses`

```json
{
  "date": "2025-01-15",
  "product_name": "Tomatoes",
  "quantity": 10,
  "amount": 125.00,
  "unit": "kgs",
  "currency": "TRY",
  "payment_method": "cash",
  "category": "food"
}
```

**Response** (if price change detected):
```json
{
  "success": true,
  "data": { /* expense */ },
  "priceSuggestion": { /* suggestion details */ },
  "message": "Expense created successfully. Price change detected - please review suggestion."
}
```

### Updating Product Price Based on Suggestion

**Endpoint:** `POST /api/v1/expenses/:expenseId/update-product-price`

```json
{
  "product_id": "product_id_here",
  "updateSellingPrice": true  // Set to true to update selling price, false to only update cost price
}
```

**Response:**
```json
{
  "success": true,
  "message": "Product price updated successfully",
  "data": {
    "product": {
      "id": "product_id",
      "name": "Tomatoes",
      "sku": "TOMATO-001",
      "cost_price": 12.50,
      "price": 18.75,
      "markup_percentage": 50
    },
    "updatedFields": {
      "costPrice": 12.50,
      "sellingPrice": 18.75
    }
  }
}
```

## Setting Up Products

### When Creating a Product

You can set `cost_price` and `markup_percentage` when creating a product:

```json
{
  "name": "Tomatoes",
  "price": 15.00,
  "cost_price": 10.00,
  "markup_percentage": 50,
  "category": "Vegetables",
  "sku": "TOMATO-001",
  "stock_quantity": 100,
  "store_id": "store_id",
  "created_by": "user_id"
}
```

### Calculating Markup Percentage

Markup percentage is calculated as: `((selling_price - cost_price) / cost_price) * 100`

Example:
- Cost price: 10.00
- Selling price: 15.00
- Markup: ((15 - 10) / 10) * 100 = 50%

### Auto-calculating Markup

If you don't set `markup_percentage` when creating a product, but you have both `cost_price` and `price`, the system can calculate the markup from previous expenses when a price change is detected.

## Workflow Example

1. **Week 1:** Create a product "Tomatoes" with:
   - Cost price: 10.00 TRY/kg
   - Selling price: 15.00 TRY/kg
   - Markup: 50%

2. **Week 2:** Record an expense:
   - Product: "Tomatoes"
   - Quantity: 10 kgs
   - Amount: 125.00 TRY
   - Cost per unit: 12.50 TRY/kg

3. **System detects:**
   - Old cost: 10.00
   - New cost: 12.50
   - Change: +25%
   - Suggested selling price: 12.50 * 1.50 = 18.75 TRY/kg

4. **You receive a suggestion** in the expense creation response

5. **You can choose to:**
   - Update only cost price: `updateSellingPrice: false`
   - Update both cost and selling price: `updateSellingPrice: true`
   - Ignore the suggestion and keep current prices

## Benefits

1. **Automated Price Monitoring**: No need to manually track cost price changes
2. **Markup Consistency**: Maintains your desired markup percentage automatically
3. **Profitability Protection**: Ensures selling prices adjust with cost changes
4. **Time Saving**: Reduces manual calculations and price updates
5. **Historical Tracking**: Links expenses to products for better inventory management

## Notes

- Price change threshold: 1% (changes less than 1% are ignored)
- Product matching is case-insensitive for product names
- If a product doesn't have a cost_price set, the system will suggest setting it
- If a product doesn't have a markup_percentage set, the system calculates it from current price/cost ratio
- Price updates are logged in ProductPriceHistory if available

## Future Enhancements

Potential improvements:
- Bulk price updates for multiple products
- Price trend analysis over time
- Automatic price update rules (e.g., always update if cost increases >10%)
- Cost price averaging across multiple expenses
- Currency conversion support for multi-currency expenses


