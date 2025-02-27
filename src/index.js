const puppeteer = require('puppeteer');
const nodemailer = require("nodemailer");
const dotenv = require('dotenv');
dotenv.config();

let browser = null;
let page = null;
let authToken = null;
let previousEmail = null;

const MAIN = async () => {

    // Launch a new browser instance if none exist
    if (!browser || !page || !authToken) {
        // browser = await puppeteer.launch({ headless: true, args: ['--window-position=-2400,-2400'] });
        browser = await puppeteer.launch({ headless: false, defaultViewport: null,});

        page = await browser.newPage();
        await page.goto(process.env.NHS_WEBSITE, { waitUntil: 'networkidle0' });
    
        
        // Intercept requests to get the Authorization header
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (request.url() === 'https://bank.nhsp.uk/mybankapi/api/Calendar') {
                const headers = request.headers();
                authToken = headers.authorization
            }
    
            request.continue();
        });
    
        
        // log in
        await page.waitForSelector('input#login');
        await page.type('input#login', process.env.NHS_USERNAME);
        await page.type('input#password', process.env.NHS_PASSWORD);
        await page.click('button#showloadinfo');
        await page.waitForNavigation({ waitUntil: 'networkidle0' });
    }


    const keepScraping = async () => {
        // Send API request from the page context
        const shiftsResponse = await fetchShifts(page)
    
        console.log('shiftsResponse', shiftsResponse)
        
        if (!shiftsResponse.Shifts) {
            console.log(getTime() + ': 0 shifts found');
            previousEmail = null;
            return
        }

        // format response
        const formattedShifts = shiftsResponse.Shifts.map(shift => ({
            ShiftDate: shift.ShiftDate,
            Location: shift.Location.Name,
            Ward: shift.Ward.Name,
            StartTime: shift.StartTime.split('T')[1].slice(0, 5),
            EndTime: shift.EndTime.split('T')[1].slice(0, 5),    
            Notes: shift.Notes
        }));
        
        
        // send the email if new shifts are found
        const emailBody = generateEmailHtml(formattedShifts);
        if (emailBody !== previousEmail && formattedShifts.length > 0) {
            previousEmail = emailBody;
            sendEmail(emailBody, formattedShifts.length);
        } else {
            console.log(getTime() + ': No new shifts found')
        }

    }


    // fetch the data and send an email every 60 seconds
    keepScraping();
    setInterval(keepScraping, 60000);



}


// try 3 times
try { MAIN() }
catch (error) {
    try { MAIN() }
    catch (error) { MAIN() }
}



// returns the start and end date range 
// as an array [today, today + 1 month]
const calculateDays = () => {
    const today = new Date();
    const oneMonthLater = new Date();
    oneMonthLater.setMonth(today.getMonth() + 1);
    // oneMonthLater.setDate(today.getDay() + 10)


  
    // Format function to get 'YYYY-MM-DDT00:00:00.000Z'
    const formatDate = (date) => {
      return date.toISOString().split('T')[0] + 'T00:00:00.000Z';
    };
  
    const startDate = formatDate(today);
    const endDate = formatDate(oneMonthLater);

    console.log('startDate', startDate)
    console.log('endDate', endDate)

    return[startDate, endDate]
}


// Send the API request from the page context
// to fecth aavailable shifts
const fetchShifts = async (page) => {
    return await page.evaluate(async (startDate, endDate, authToken) => {
        const res = await fetch('https://bank.nhsp.uk/mybankapi/api/AvailableShifts_AdvancedSearch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authToken,
            },
            body: JSON.stringify({
                AssignmentCode: null,
                EndDate: endDate,
                HideOverlap: true,
                LocationCode: [],
                MatchShiftsToMyAvailability: false,
                ShiftType: null,
                StartDate: startDate,
                TrustCode: [],
                WardCode: []
            })
        });

        return await res.json();
    }, ...calculateDays(), authToken);
}


// formatss the dta into an email
const generateEmailHtml = (shifts) => {
    let emailBody = `<h2>Upcoming Shifts </h2> <hr> `;
    
    shifts.forEach(shift => {

        // format date
        const shiftDate = new Date(shift.ShiftDate);
        const weekday = shiftDate.toLocaleDateString('en-US', { weekday: 'long' });
        const day = shiftDate.getDate();
        const month = shiftDate.toLocaleDateString('en-US', { month: 'long' });
        const year = shiftDate.getFullYear();
        const time = shiftDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const formattedDate = `${weekday} ${day} ${month} ${year} @ ${time}`;

        emailBody += `
            <h3>Shift Date: ${formattedDate}</h3>
            <p><strong>Location:</strong> ${shift.Location}</p>
            <p><strong>Ward:</strong> ${shift.Ward}</p>
            <p><strong>Start Time:</strong> ${shift.StartTime}</p>
            <p><strong>End Time:</strong> ${shift.EndTime}</p>
            <p><strong>Notes:</strong></p>
            <ul>
        `;
        
        shift.Notes.length > 0
            ? shift.Notes.forEach(note => emailBody += `<li> ${note} </li>` )
            : emailBody += '<li>No additional notes</li>';
       
        emailBody += ` </ul> <hr> <a href='${process.env.NHS_WEBSITE}'> Book Now </a> `;
    });
    
    return emailBody;
};


// send email using node mailer
const sendEmail = (message, count) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
        user: process.env.EMAIL_SENDER,
        pass: process.env.EMAIL_PASSWORD
        }
    });

    const mailOptions = {
        from: process.env.EMAIL_SENDER, 
        to: process.env.EMAIL_RECEIVER, 
        subject: count + ' Shifts Found!', 
        html: message 
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) { return console.log('Error:', error) }
        console.log(getTime() + ': Email sent ' + info.response);
    });
}


// returns the current time in hh:mm format
const getTime = () => {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// wed thur fri
