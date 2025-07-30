// Load environment variables from .env file
require('dotenv').config();

const fs = require('fs');
const csv = require('csv-parser');
const jsforce = require('jsforce');

class SalesforceCSVUpserter {
    constructor(config) {
        this.config = config;
        this.conn = new jsforce.Connection({
            loginUrl: config.loginUrl || 'https://login.salesforce.com'
        });
    }

    /**
     * Authenticate with Salesforce
     */
    async authenticate() {
        try {
            const userInfo = await this.conn.login(this.config.username, this.config.password + this.config.securityToken);
            console.log('Successfully authenticated with Salesforce');
            console.log('User ID:', userInfo.id);
            console.log('Org ID:', userInfo.organizationId);
            return userInfo;
        } catch (error) {
            console.error('Authentication failed:', error);
            throw error;
        }
    }

    /**
     * Read and parse CSV file
     */
    async readCSV(filePath) {
        return new Promise((resolve, reject) => {
            const records = [];
            
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (row) => {
                    // Clean up the row data - remove empty strings and trim whitespace
                    const cleanedRow = {};
                    Object.keys(row).forEach(key => {
                        const cleanedKey = key.trim();
                        const value = row[key];
                        if (value !== null && value !== undefined && value !== '') {
                            cleanedRow[cleanedKey] = typeof value === 'string' ? value.trim() : value;
                        }
                    });
                    
                    if (Object.keys(cleanedRow).length > 0) {
                        records.push(cleanedRow);
                    }
                })
                .on('end', () => {
                    console.log(`Successfully parsed ${records.length} records from CSV`);
                    resolve(records);
                })
                .on('error', (error) => {
                    console.error('Error reading CSV:', error);
                    reject(error);
                });
        });
    }

    /**
     * Parse and format datetime values for Salesforce - handle Pacific time formats and add 5 hours
     */
    formatDateTimeValue(value) {
        if (!value) return null;
        
        try {
            let date;
            
            // Handle different date formats
            if (typeof value === 'string') {
                // Handle MM/dd/yy H:mm format like "6/20/24 3:24"
                if (value.includes('/') && value.includes(' ')) {
                    const [datePart, timePart] = value.split(' ');
                    const [month, day, year] = datePart.split('/');
                    const [hour, minute] = timePart.split(':');
                    
                    // Convert 2-digit year to 4-digit (assuming 20xx)
                    const fullYear = year.length === 2 ? `20${year}` : year;
                    
                    // Create date object (this will be in local timezone - Pacific)
                    date = new Date(fullYear, month - 1, day, hour, minute, 0);
                }
                // Handle ISO datetime strings like "2024-06-20T03:24:00.000Z"
                else if (value.includes('T')) {
                    // Remove Z and treat as Pacific time
                    let dateString = value.endsWith('Z') ? value.slice(0, -1) : value;
                    if (dateString.includes('.')) {
                        dateString = dateString.split('.')[0];
                    }
                    date = new Date(dateString);
                } else {
                    date = new Date(value);
                }
            } else {
                date = new Date(value);
            }
            
            if (isNaN(date.getTime())) {
                return value;
            }
            
            // Add 5 hours to the date
            date.setHours(date.getHours() + 6);
            
            // Format as ISO without timezone indicator (treats as local Pacific time)
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hour = String(date.getHours()).padStart(2, '0');
            const minute = String(date.getMinutes()).padStart(2, '0');
            const second = String(date.getSeconds()).padStart(2, '0');
            
            const formattedDateTime = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
            
            return formattedDateTime;
            
        } catch (error) {
            console.warn(`Warning: Could not parse datetime value "${value}":`, error.message);
            return value;
        }
    }

    /**
     * Transform CSV data to match Salesforce field names and handle datetime fields
     */
    transformData(records, fieldMapping) {
        return records.map(record => {
            const transformedRecord = {};
            
            Object.keys(fieldMapping).forEach(csvField => {
                const salesforceField = fieldMapping[csvField];
                if (record[csvField] !== undefined) {
                    let value = record[csvField];
                    
                    // Check if this looks like a datetime field (contains 'Date' or 'Time' in field name or is D2)
                    const isDateTimeField = csvField.toLowerCase().includes('date') || 
                                          csvField.toLowerCase().includes('time') || 
                                          csvField === 'D2' ||
                                          salesforceField.toLowerCase().includes('date') || 
                                          salesforceField.toLowerCase().includes('time');
                    
                    // If it's a datetime field and the value looks like an ISO datetime string
                    if (isDateTimeField && typeof value === 'string' && 
                        (value.includes('T') || value.includes('-') || value.includes('/'))) {
                        value = this.formatDateTimeValue(value);
                    }
                    
                    transformedRecord[salesforceField] = value;
                }
            });
            
            return transformedRecord;
        });
    }

    /**
     * Perform batch upserts with error handling
     */
    async batchUpsert(sobjectType, records, externalIdField, batchSize = 200) {
        const results = [];
        const errors = [];
        
        // Process records in batches
        for (let i = 0; i < records.length; i += batchSize) {
            const batch = records.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(records.length / batchSize)}`);
            
            try {
                const batchResults = await this.conn.sobject(sobjectType).upsert(batch, externalIdField);
                
                // Handle both single record and array responses
                const resultsArray = Array.isArray(batchResults) ? batchResults : [batchResults];
                
                resultsArray.forEach((result, index) => {
                    const recordIndex = i + index;
                    if (result.success) {
                        results.push({
                            index: recordIndex,
                            id: result.id,
                            created: result.created,
                            record: batch[index]
                        });
                        
                        // Print date information for records being pushed
                        const record = batch[index];
                        let dateInfo = '';
                        if (record.NS_Created_Date__c) {
                            dateInfo = ` | Date: ${record.NS_Created_Date__c}`;
                        }
                        
                        console.log(`✓ Record ${recordIndex + 1}: ${result.created ? 'Created' : 'Updated'} - ID: ${result.id}${dateInfo}`);
                    } else {
                        const error = {
                            index: recordIndex,
                            errors: result.errors,
                            record: batch[index]
                        };
                        errors.push(error);
                        console.error(`✗ Record ${recordIndex + 1} failed:`, result.errors);
                    }
                });
                
            } catch (error) {
                console.error(`Batch ${Math.floor(i / batchSize) + 1} failed:`, error);
                
                // Add all records in failed batch to errors
                batch.forEach((record, index) => {
                    errors.push({
                        index: i + index,
                        errors: [{ message: error.message }],
                        record: record
                    });
                });
            }
            
            // Small delay between batches to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        return { results, errors };
    }

    /**
     * Generate error report
     */
    generateErrorReport(errors, outputPath) {
        if (errors.length === 0) {
            console.log('No errors to report');
            return;
        }

        const errorReport = errors.map(error => ({
            'Record Index': error.index + 1,
            'Error Messages': error.errors.map(e => e.message).join('; '),
            'Failed Record': JSON.stringify(error.record)
        }));

        const csvHeader = Object.keys(errorReport[0]).join(',') + '\n';
        const csvContent = errorReport.map(row => 
            Object.values(row).map(value => `"${value}"`).join(',')
        ).join('\n');

        fs.writeFileSync(outputPath, csvHeader + csvContent);
        console.log(`Error report saved to: ${outputPath}`);
    }

    /**
     * Main upsert process
     */
    async upsertFromCSV(options) {
        const {
            csvFilePath,
            sobjectType,
            externalIdField,
            fieldMapping = {},
            batchSize = 200,
            errorReportPath = 'upsert_errors.csv',
            recordLimit = -1 // -1 means process all records in file
        } = options;

        try {
            // Step 1: Authenticate
            await this.authenticate();

            // Step 2: Read CSV
            console.log('Reading CSV file...');
            let records = await this.readCSV(csvFilePath);

            // Step 3: Transform data if mapping provided
            if (Object.keys(fieldMapping).length > 0) {
                console.log('Transforming data based on field mapping...');
                records = this.transformData(records, fieldMapping);
            }

            // Step 4: Apply record limit if specified
            if (recordLimit !== -1 && recordLimit > 0) {
                const originalCount = records.length;
                records = records.slice(0, recordLimit);
                console.log(`Limited records from ${originalCount} to ${records.length} based on recordLimit setting`);
            } else {
                console.log(`Processing all ${records.length} records from file (recordLimit = ${recordLimit})`);
            }

            // Step 5: Validate records have external ID
            if (externalIdField) {
                records = records.filter(record => record[externalIdField]);
                console.log(`Filtered to ${records.length} records with ${externalIdField} field`);
            }

            if (records.length === 0) {
                console.log('No valid records to process');
                return;
            }

            // Step 6: Perform upsert
            console.log(`Starting upsert of ${records.length} records...`);
            const { results, errors } = await this.batchUpsert(
                sobjectType, 
                records, 
                externalIdField, 
                batchSize
            );

            // Step 7: Report results
            console.log('\n=== UPSERT SUMMARY ===');
            console.log(`Total records processed: ${records.length}`);
            console.log(`Successful upserts: ${results.length}`);
            console.log(`Failed upserts: ${errors.length}`);
            
            if (results.length > 0) {
                const created = results.filter(r => r.created).length;
                const updated = results.length - created;
                console.log(`  - Created: ${created}`);
                console.log(`  - Updated: ${updated}`);
            }

            // Step 8: Generate error report if needed
            if (errors.length > 0) {
                this.generateErrorReport(errors, errorReportPath);
            }

            return { results, errors };

        } catch (error) {
            console.error('Upsert process failed:', error);
            throw error;
        }
    }
}

// Usage example
async function main() {
    // Configuration - now using environment variables from .env file
    const config = {
        username: process.env.SALESFORCE_USERNAME,
        password: process.env.SALESFORCE_PASSWORD,
        securityToken: process.env.SALESFORCE_SECURITY_TOKEN,
        loginUrl: process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com'
    };

    // Validate required environment variables
    if (!config.username || !config.password || !config.securityToken) {
        console.error('Missing required environment variables. Please check your .env file contains:');
        console.error('SALESFORCE_USERNAME=your_username');
        console.error('SALESFORCE_PASSWORD=your_password');
        console.error('SALESFORCE_SECURITY_TOKEN=your_security_token');
        console.error('SALESFORCE_LOGIN_URL=https://login.salesforce.com (optional)');
        process.exit(1);
    }

    // Field mapping from CSV columns to Salesforce fields
    const fieldMapping = {
        'Document Number': 'Invoice_NS_Id__c',
        'D2': 'NS_Created_Date__c',
    };

    const upserter = new SalesforceCSVUpserter(config);

    try {
        await upserter.upsertFromCSV({
            csvFilePath: 'invoice.csv',
            sobjectType: 'Invoice__c',
            externalIdField: 'Invoice_NS_Id__c', // or 'Email' for email-based upserts
            fieldMapping: fieldMapping,
            batchSize: 200,
            errorReportPath: 'contact_upsert_errors.csv',
            recordLimit: 5
        });
    } catch (error) {
        console.error('Process failed:', error);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = SalesforceCSVUpserter;