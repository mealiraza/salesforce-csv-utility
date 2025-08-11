# Salesforce CSV Upserter

A Node.js utility for batch upserting CSV data into Salesforce objects with robust error handling, field mapping, and datetime transformation capabilities.

## Features

- **Batch Processing**: Efficiently processes large CSV files in configurable batch sizes
- **Smart Upserts**: Creates new records or updates existing ones based on external ID fields
- **Field Mapping**: Flexible mapping between CSV column names and Salesforce field names
- **Datetime Handling**: Automatically detects and formats datetime fields with timezone adjustments
- **Error Reporting**: Comprehensive error logging with detailed CSV reports
- **Environment Variables**: Secure credential management using `.env` files
- **Data Validation**: Cleans and validates data before processing

## Installation

1. Clone this repository:
```bash
git clone <repository-url>
cd salesforce-csv-upserter
```

2. Install dependencies:
```bash
npm install jsforce csv-parser dotenv
```

3. Create a `.env` file in the project root:
```env
SALESFORCE_USERNAME=your_salesforce_username
SALESFORCE_PASSWORD=your_salesforce_password
SALESFORCE_SECURITY_TOKEN=your_security_token
SALESFORCE_LOGIN_URL=https://login.salesforce.com
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SALESFORCE_USERNAME` | Your Salesforce username | Yes |
| `SALESFORCE_PASSWORD` | Your Salesforce password | Yes |
| `SALESFORCE_SECURITY_TOKEN` | Your Salesforce security token | Yes |
| `SALESFORCE_LOGIN_URL` | Salesforce login URL (defaults to production) | No |

**Getting Your Security Token:**
1. Log into Salesforce
2. Go to Settings → My Personal Information → Reset My Security Token
3. Check your email for the new security token

### Salesforce Login URLs

- **Production/Developer**: `https://login.salesforce.com`
- **Sandbox**: `https://test.salesforce.com`

## Usage

### Basic Usage

```javascript
const SalesforceCSVUpserter = require('./salesforce-csv-upserter');

const config = {
    username: process.env.SALESFORCE_USERNAME,
    password: process.env.SALESFORCE_PASSWORD,
    securityToken: process.env.SALESFORCE_SECURITY_TOKEN,
    loginUrl: process.env.SALESFORCE_LOGIN_URL
};

const upserter = new SalesforceCSVUpserter(config);

await upserter.upsertFromCSV({
    csvFilePath: 'data.csv',
    sobjectType: 'Contact',
    externalIdField: 'Email',
    fieldMapping: {
        'First Name': 'FirstName',
        'Last Name': 'LastName',
        'Email Address': 'Email'
    },
    batchSize: 200,
    recordLimit: -1  // Process all records
});
```

### Advanced Configuration

```javascript
await upserter.upsertFromCSV({
    csvFilePath: 'invoice_data.csv',
    sobjectType: 'Invoice__c',
    externalIdField: 'Invoice_NS_Id__c',
    fieldMapping: {
        'Document Number': 'Invoice_NS_Id__c',
        'Created Date': 'NS_Created_Date__c',
        'Amount': 'Amount__c'
    },
    batchSize: 100,
    errorReportPath: 'invoice_errors.csv',
    recordLimit: 1000  // Process only first 1000 records
});
```

## Configuration Options

### `upsertFromCSV()` Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `csvFilePath` | string | - | Path to the CSV file to process |
| `sobjectType` | string | - | Salesforce object type (e.g., 'Contact', 'Account') |
| `externalIdField` | string | - | Field to use for upsert matching |
| `fieldMapping` | object | `{}` | Map CSV columns to Salesforce fields |
| `batchSize` | number | `200` | Number of records per batch |
| `errorReportPath` | string | `'upsert_errors.csv'` | Path for error report file |
| `recordLimit` | number | `-1` | Limit records processed (-1 = all) |

## Field Mapping

Map CSV column headers to Salesforce API field names:

```javascript
const fieldMapping = {
    'CSV Column Name': 'Salesforce_API_Name__c',
    'Customer Email': 'Email',
    'Full Name': 'Name',
    'Phone Number': 'Phone'
};
```

## Datetime Handling

The tool automatically handles datetime fields with these features:

- **Format Detection**: Supports multiple datetime formats:
  - `MM/dd/yy H:mm` (e.g., "6/20/24 3:24")
  - ISO format with timezone (e.g., "2024-06-20T03:24:00.000Z")
  - Standard datetime strings

- **Timezone Adjustment**: Adds 6 hours to datetime values (configurable in code)

- **Field Detection**: Automatically processes fields containing:
  - "date" or "time" in the field name
  - Specific field names like "D2"
  - Salesforce field names with "date" or "time"

## Error Handling

### Error Reports

Failed records are automatically saved to a CSV file with:
- Record index number
- Error messages
- Full record data for debugging

### Console Logging

Real-time progress tracking shows:
- Batch processing status
- Individual record success/failure
- Summary statistics
- Datetime information for processed records

## CSV File Requirements

- **Headers**: First row must contain column headers
- **Encoding**: UTF-8 recommended
- **External ID**: Records must have values for the external ID field
- **Data Cleaning**: Empty cells and whitespace are automatically cleaned

### Example CSV Structure

```csv
Document Number,D2,Amount,Status
INV-001,6/20/24 3:24,1500.00,Active
INV-002,6/21/24 10:15,2300.50,Pending
```

## Running the Script

### Command Line

```bash
node salesforce-csv-upserter.js
```

### Programmatic Usage

```javascript
const SalesforceCSVUpserter = require('./salesforce-csv-upserter');

async function processData() {
    const upserter = new SalesforceCSVUpserter(config);
    
    const { results, errors } = await upserter.upsertFromCSV({
        csvFilePath: 'my-data.csv',
        sobjectType: 'Custom_Object__c',
        externalIdField: 'External_Id__c'
    });
    
    console.log(`Processed ${results.length} records successfully`);
    console.log(`${errors.length} records failed`);
}
```

## Common Use Cases

### Contact Upserts
```javascript
await upserter.upsertFromCSV({
    csvFilePath: 'contacts.csv',
    sobjectType: 'Contact',
    externalIdField: 'Email',
    fieldMapping: {
        'First': 'FirstName',
        'Last': 'LastName',
        'Email': 'Email',
        'Company': 'AccountId'  // Requires Account lookup
    }
});
```

### Custom Object Updates
```javascript
await upserter.upsertFromCSV({
    csvFilePath: 'invoices.csv',
    sobjectType: 'Invoice__c',
    externalIdField: 'Invoice_Number__c',
    fieldMapping: {
        'Invoice ID': 'Invoice_Number__c',
        'Amount': 'Total_Amount__c',
        'Date': 'Invoice_Date__c'
    }
});
```

## Troubleshooting

### Common Issues

**Authentication Errors:**
- Verify username, password, and security token
- Check if IP is whitelisted or use VPN
- Ensure correct login URL (production vs sandbox)

**Field Mapping Issues:**
- Use Salesforce API names, not labels
- Check field permissions for the user
- Verify custom field names include `__c` suffix

**Datetime Parsing:**
- Check datetime format in CSV
- Adjust timezone offset in `formatDateTimeValue()` method
- Ensure datetime fields are properly mapped

**Rate Limiting:**
- Reduce batch size if hitting API limits
- Increase delay between batches (modify setTimeout value)
- Check your org's API usage limits

### Debug Mode

Enable detailed logging by modifying the console.log statements or add:

```javascript
// Add debug flag to constructor
const upserter = new SalesforceCSVUpserter({...config, debug: true});
```

## API Limits

- **Daily API Limits**: Check your Salesforce org's API usage
- **Batch Size**: Maximum 200 records per batch recommended
- **Rate Limiting**: Built-in 100ms delay between batches

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review Salesforce API documentation
3. Open an issue on GitHub

---

**Note**: Always test with a small dataset first and verify field mappings in a sandbox environment before running on production data.
