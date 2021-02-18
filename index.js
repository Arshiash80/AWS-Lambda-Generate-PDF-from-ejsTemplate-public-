const AWS = require('aws-sdk');
var docClient = new AWS.DynamoDB.DocumentClient();
const tools = require("./tools.js") // 👈 tools
const s3 = new AWS.S3(); // 👈 initialize our instance
require('dotenv').config() // Config enviroment variables.

const { puppeteer, args, defaultViewport, executablePath } = require("chrome-aws-lambda");
const path = require('path')
const ejs = require('ejs')
const fs = require('fs')
const utils = require('util')
const readFile = utils.promisify(fs.readFile)

module.exports.handler = async event => {
    let result = null;
    let browser = null;

    let eventParams = event.params

    // Check necessery fields before using them.
    try {
        tools.checkParameters(eventParams)
    } catch (error) {
        return tools.createResponse(true, error);
    }

    const filename = `invoicepdf-${eventParams.invoiceDate}-${eventParams.invoiceId}.pdf` // 👈 make it unique or else the file will be replaced
    

    const pdfPath = `/tmp/${filename}` // NOTE: !! 📌📌
    //  whenever we run our function it will generate this temporary directory 
    // and once the execution of the function is done, 
    // it will discard it. This provides the perfect environment needed to 
    // create a pdf file and store it in S3(more permanent storage).    

    let data = {  
        address: {
            restaurantName: eventParams.restaurantName,
            specification: eventParams.specification,
            postcode: eventParams.postCode
        },
        invoice: { // Generate this fields here!
            date: eventParams.invoiceDate,
            no: eventParams.invoiceNo
        },
        wasteOil: {
            code: eventParams.wasteOilCode,
            liters: eventParams.wasteOilLiters,
            payment: eventParams.wasteOilPayment
        },
        products: eventParams.products,
        totalPrice: productsTotalPrice(eventParams.products) 
    };

    try {
        // console.log("Establishing connection...");
        // Initialize and launched puppeteer
        browser = await puppeteer.launch({
            args,
            defaultViewport,
            executablePath: await executablePath,
            headless: true,  // 👈 Very important, to run headless chrome
            ignoreHTTPSErrors: true,
        });

        // console.log("Opening new page...");
        // 👇 create a new headless chrome pag
        const page = await browser.newPage();

        // Now we have the html code of our template in res object
        // you can check by logging it on console
        // console.log(res)

        // console.log("Generating PDF file from HTML template...");
        // 👇 Loading template file
        let res = await getTemplateHtml()
        // console.log("Compiling the template with ejs")
        const template = ejs.compile(res);
        // we have compile our code with ejs
        const r = template(data);  
        // We can use this to add dyamic data to our ejs template at run time from database or API as per need.
        const html = r;
        await page.setContent(html, { waitUntil: "networkidle2" });

        // 👇 this tells puppeteer to save the webpage as a pdf file
        await page.pdf({ format: "A4", path: pdfPath });

        const params = {
            Key: `invoices/invoicepdf-${eventParams.invoiceDate}-${eventParams.invoiceId}`,
            Body: fs.createReadStream(pdfPath),
            Bucket: process.env.S3_BUCKET,
            ContentType: "application/pdf",
        };

        // console.log("Uploading PDF...");
        // 👇 Pretty self explanatory but this is what uploads
        // and store our PDF or file to S3
        let wait = await s3.putObject(params).promise();
    } catch (error) {
        return tools.createResponse(true, error.message);
    } finally {
        if (browser !== null) {
            // console.log("Closing browser...");
            browser.close();
        }
    }
    return tools.createResponse(false, "DONE!!");
}
async function getTemplateHtml() {
    // console.log("Loading template file in memory")
    try {
        const invoicePath = path.resolve("./assets/invoice.ejs");
        return await readFile(invoicePath, 'utf8');
    } catch (err) {
        return tools.createResponse(true, err);
    }
}

function productsTotalPrice(products) {
    let total
    products.forEach(price => {
        total += price
    });
    return Number(total)
}