import { Request, Response } from 'express';
import * as dotenv from 'dotenv';
import axios from 'axios';


dotenv.config();

function formatDateYear(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
    const year = date.getFullYear().toString().slice(-4); // Get last two digits of year
    return `${day}-${month}-${year}`;
}
export const sendSMS = async (req: Request, res: Response): Promise<void> => {
    try {
        const { patientName, doctorName, time, date, patientPhoneNumber, doctorPhoneNumber, status, prefix } = req.body;

        let name = `${prefix} ${patientName}`

        // if (!patientName || !doctorName || !time || !date || !patientPhoneNumber || !doctorPhoneNumber || !status) {
        //    res.status(400).json({ error: 'Missing required fields' });
        // }

        const responses = [];
        let patient_message = '';
        if(status === 'cancelled'){
        patient_message = `Namaste ${name}, your appointment with ${doctorName} at ${time} on ${date} stands cancelled. Please contact 97420 20123 for any further assistance. Regards, Team Rashtrotthana`
        const apiKey = process.env.SMS_API_KEY;
        const apiUrl = process.env.SMS_API_URL;
        const sender = process.env.SMS_SENDER;
        const dltTemplateIdForPatient = process.env.SMS_DLT_TE_ID_FOR_APPT_CANCEL;
        const url = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(patient_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdForPatient}`;
        const response = await axios.get(url);
        console.log(response)
        responses.push({ recipient: 'doctor', data: response.data });
        }
        // patient_message =`Hello ${patientName}, your appointment with ${doctorName} is ${status} on ${formatDateYear(new Date(date))} at ${time}. For any questions, please contact 97420 20123. Thank You! Regards, Rashtrotthana Team`;
        patient_message = `Namaste ${name}, your appointment with ${doctorName} is ${status} at ${time}  on ${formatDateYear(new Date(date))}. Please contact  97420 20123 for any further assistance. Thank You! Regards, Team Rashtrotthana`
        const apiKey = process.env.SMS_API_KEY;
        const apiUrl = process.env.SMS_API_URL;
        const sender = process.env.SMS_SENDER;
        const dltTemplateIdForPatient = process.env.SMS_DLT_TE_ID_FOR_PATIENT;
        const url = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(patient_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdForPatient}`;
        const response = await axios.get(url);
        console.log(response)
        responses.push({ recipient: 'doctor', data: response.data });

        // let doctor_message = `Hi ${doctorName}, you have an ${status} appointment with ${patientName} on ${formatDateYear(new Date(date))} at ${time}. For any questions, please contact 8904943673. Thank You! Regards, Rashtrotthana Team`;
        let doctor_message = `Namaste ${doctorName}, you have a ${status} appointment with ${name}  at ${time}  on ${formatDateYear(new Date(date))}. Please contact 8904943673 for any further assistance. Regards,Team Rashtrotthana`
        const dltTemplateIdfordoctor = process.env.SMS_DLT_TE_ID_FOR_DOCTOR;
        const urlfordoctor = `${apiUrl}/${sender}/${doctorPhoneNumber}/${encodeURIComponent(doctor_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdfordoctor}`;
        const responseofdoctor = await axios.get(urlfordoctor);
        responses.push({ recipient: 'doctor', data: responseofdoctor.data });

        res.status(200).json({ message: 'SMS sent successfully', data: responses });


        if (status === 'received') {
            // let receive_message = `Hi ${patientName}, We have received your appointment request with ${doctorName}. Our team will process it and get back to you shortly. If you have any immediate questions, please reach out to us at 97420 20123. Thank you!`;
            let receive_message = `Namaste ${patientName}, We have received your appointment request with ${doctorName}. Our team will process it and get back to you shortly. Please contact 97420 20123 for any further assistance. Regards, Team Rashtrotthana
`
            const dltTemplateIdforreceived = process.env.SMS_DLT_TE_ID_FOR_RECEIVED;
            const urlforreceived = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(receive_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdforreceived}`;
            const responseofreceived = await axios.get(urlforreceived);
            // console.log(urlforreceived);
            responses.push({ recipient: 'patient (received)', data: responseofreceived.data });
        }
        // if(status === 'otp'){
        //     let otp_message= `Dear ${patientName}, ${patientPhoneNumber} is your One Time Password from Rashtrotthana Hospital for ${doctorName} service. Expires in 2 mins. Please do not share this OTP with anyone.`;
        //     const dltTemplateIdforotp = process.env.SMS_DLT_TE_ID_FOR_OTP;
        //     const urlforotp = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(otp_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdforotp}`;
        //     const responseofotp = await axios.get(urlforotp);
        //     responses.push({ recipient: 'patient (otp)', data: responseofotp.data });
        //     console.log(urlforotp);
        // }

        // res.status(200).json({ message: 'SMS sent successfully', responses });
    } catch (error) {
        console.error('Error sending SMS:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
export const sendSMSChatbot = async (req: Request, res: Response): Promise<void> => {
    try {

        const responses = []
        const { patientName, otp, service, patientPhoneNumber } = req.body;
        if (otp) {
            let patient_message = `Dear ${patientName}, ${otp} is your One Time Password from Rashtrotthana Hospital for ${service} service. Expires in 2 mins. Please do not share this OTP with anyone.`;

            // console.log(patient_message)
            const apiKey = process.env.SMS_API_KEY;
            const apiUrl = process.env.SMS_API_URL;
            const sender = process.env.SMS_SENDER;
            const dltTemplateIdForOTP = process.env.SMS_DLT_TE_ID_FOR_OTP;
            const url = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(patient_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdForOTP}`;
            const response = await axios.get(url);
            responses.push({ recipient: 'otp', data: response.data });

        }
        else {
            let message = `Dear ${patientName}, We have received your request for ${service} from Rashtrotthana Hospital. Our team will get back to you shortly. Thank you for choosing us!`
            const apiKey = process.env.SMS_API_KEY;
            const apiUrl = process.env.SMS_API_URL;
            const sender = process.env.SMS_SENDER;
            const dltTemplateIdforreceivedotp = process.env.SMS_DLT_TE_ID_FOR_CHATBOT;
            const url = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdforreceivedotp}`;
            const response = await axios.get(url);
            responses.push({ recipient: 'received', data: response.data });
        }
        res.status(200).json({ message: 'SMS sent successfully', responses });

    }
    catch (error) {
        console.error('Error sending SMS:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export const sendSMSforHealthCheckup = async (req: Request, res: Response): Promise<void> => {
    try {
        const { patientName, doctorName, time, date, patientPhoneNumber, doctorPhoneNumber, status, packageName, prefix } = req.body;

        // if (!patientName || !doctorName || !time || !date || !patientPhoneNumber || !doctorPhoneNumber || !status) {
        //    res.status(400).json({ error: 'Missing required fields' });
        // }

        let name = `${prefix} ${patientName}`

        const responses = [];

        let patient_message = '';

        const apiKey = process.env.SMS_API_KEY;
        const apiUrl = process.env.SMS_API_URL;
        const sender = process.env.SMS_SENDER;
        const dltTemplateIdForPatient = process.env.SMS_DLT_TE_ID_FOR_HEALTH_CHECKUP_STATUS;
        if (status === 'Confirmed' || status === 'confirmed' || status === 'Confirm' || status === 'Rescheduled' || status === 'rescheduled') {
            // patient_message = `Namaste ${patientName}, Your ${packageName} package is ${status} for ${formatDateYear(new Date(date))} at ${time}. Kindly note that there is a standard Turnaround Time (TAT) for all investigation reports. We appreciate your patience and recommend consulting your doctor once the reports are ready. For any assistance, please contact 97420 20123. Thank You! Regards, Team Rashtrotthana`;
            patient_message = `Namaste, ${name} Your ${packageName} package is ${status} at ${time} on ${formatDateYear(new Date(date))} Kindly note that there is a standard Turnaround Time (TAT) for all investigation reports. We appreciate your patience and recommend consulting your doctor once the reports are ready. Please contact  97420 20123 for any further assistance. Regards, Team Rashtrotthana`
            const url = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(patient_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdForPatient}`;
            const response = await axios.get(url);


            responses.push({ recipient: 'doctor', data: response.data });
            res.status(200).json({ message: 'SMS sent successfully', data: response.data });
        }
        if (status === 'Cancelled' || status === 'Cancel') {
            // let cancel_message = `Namaste ${patientName}, Your ${packageName} package scheduled for ${formatDateYear(new Date(date))} has been Cancelled. For any further assistance or rescheduling, please contact us at 97420 20123. Regards, Team Rashtrotthana`;
            let cancel_message = `Namaste ${name}, Your ${packageName} package scheduled for ${formatDateYear(new Date(date))} has been Cancelled.  Please contact us at 97420 20123 for any further assistance. Regards, Team Rashtrotthana`
            const dltTemplateIdfordoctor = process.env.SMS_DLT_TE_ID_FOR_HEALTH_CHECKUP_CANCEL;
            const urlfordoctor = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(cancel_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdfordoctor}`;
            const responseofdoctor = await axios.get(urlfordoctor);
            responses.push({ recipient: 'doctor', data: responseofdoctor.data });
            res.status(200).json({ message: 'SMS sent successfully', data: responseofdoctor.data });

        }
        if (status === 'pending') {
            // let receive_message = `Namaste ${patientName}, We have received your health check request for the ${packageName} package. Our team will get back to you shortly. For any assistance, feel free to reach out to us at 97420 20123. Thank you! Regards, Rashtrotthana Team`;
            let receive_message = `Namaste ${patientName}, We have received your health check request for the ${packageName} package. Our team will process it and get back to you shortly.. Please contact 97420 20123 for any further assistance. Regards, Team Rashtrotthana`
            const dltTemplateIdforreceived = process.env.SMS_DLT_TE_ID_FOR_HEALTH_CHECKUP_RECEIVED;
            const urlforreceived = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(receive_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdforreceived}`;
            const responseofreceived = await axios.get(urlforreceived);
            // console.log(urlforreceived);
            responses.push({ recipient: 'patient (received)', data: responseofreceived.data });
            res.status(200).json({ message: 'SMS sent successfully', data: responseofreceived.data });
        }
    } catch (error) {
        console.error('Error sending SMS:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
export const sendSMSforRadiology = async (req: Request, res: Response): Promise<void> => {
    try {
        const { patientName, doctorName, time, date, patientPhoneNumber, doctorPhoneNumber, status, radioServiceName, prefix } = req.body;

        // if (!patientName || !doctorName || !time || !date || !patientPhoneNumber || !doctorPhoneNumber || !status) {
        //    res.status(400).json({ error: 'Missing required fields' });
        // }

        const responses = [];

        let patient_message = '';
        let name = `${prefix} ${patientName}`

        const apiKey = process.env.SMS_API_KEY;
        const apiUrl = process.env.SMS_API_URL;
        const sender = process.env.SMS_SENDER;
        const dltTemplateIdForPatient = process.env.SMS_DLT_TE_ID_FOR_SERVICE_STATUS;
        if (status === 'Confirmed' || status === 'confirmed' || status === 'Confirm' || status === 'Rescheduled' || status === 'rescheduled') {
            // patient_message = `Namaste ${patientName}, Your ${radioServiceName} package is ${status} for ${formatDateYear(new Date(date))} at ${time}. Kindly note that there is a standard Turnaround Time (TAT) for all investigation reports. We appreciate your patience and recommend consulting your doctor once the reports are ready. For any assistance, please contact 97420 20123. Thank You! Regards, Team Rashtrotthana`;
            patient_message = `Namaste ${name}, Your ${radioServiceName} service is ${status} at ${time} on ${formatDateYear(new Date(date))} Kindly note that there is a standard Turnaround Time (TAT) for all investigation reports. We appreciate your patience and recommend consulting your doctor once the reports are ready. Please contact  97420 20123 for any further assistance. Regards, Team Rashtrotthana`
            const url = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(patient_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdForPatient}`;
            const response = await axios.get(url);


            responses.push({ recipient: 'doctor', data: response.data });
            res.status(200).json({ message: 'SMS sent successfully', data: response.data });
        }
        if (status === 'Cancelled' || status === 'Cancel') {
            // let cancel_message = `Namaste ${patientName}, Your ${radioServiceName} package scheduled for ${formatDateYear(new Date(date))} has been Cancelled. For any further assistance or rescheduling, please contact us at 97420 20123. Regards, Team Rashtrotthana`;
            let cancel_message = `Namaste ${name}, Your ${radioServiceName} service scheduled for ${formatDateYear(new Date(date))} has been Cancelled.  Please contact us at 97420 20123 for any further assistance. Regards, Team Rashtrotthana`
            const dltTemplateIdfordoctor = process.env.SMS_DLT_TE_ID_FOR_SERVICE_CANCEL;
            const urlfordoctor = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(cancel_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdfordoctor}`;
            const responseofdoctor = await axios.get(urlfordoctor);
            responses.push({ recipient: 'doctor', data: responseofdoctor.data });
            res.status(200).json({ message: 'SMS sent successfully', data: responseofdoctor.data });

        }
        if (status === 'pending') {
            let receive_message = `Namaste ${patientName}, We have received your health check request for the ${radioServiceName} package. Our team will get back to you shortly. For any assistance, feel free to reach out to us at 97420 20123. Thank you! Regards, Rashtrotthana Team`;
            const dltTemplateIdforreceived = process.env.SMS_DLT_TE_ID_FOR_HEALTH_CHECKUP_RECEIVED;
            const urlforreceived = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(receive_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdforreceived}`;
            const responseofreceived = await axios.get(urlforreceived);
            // console.log(urlforreceived);
            responses.push({ recipient: 'patient (received)', data: responseofreceived.data });
            res.status(200).json({ message: 'SMS sent successfully', data: responseofreceived.data });
        }
    } catch (error) {
        console.error('Error sending SMS:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}