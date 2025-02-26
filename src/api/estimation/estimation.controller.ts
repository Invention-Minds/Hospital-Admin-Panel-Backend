import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import fs from "fs";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import path from "path";
import { Client } from "basic-ftp";
import { ServiceRepository } from '../services/services.repository';
import { notifyPendingAppointments } from '../appointments/appointment.controller';

const prisma = new PrismaClient();
const repository = new ServiceRepository();

const FTP_CONFIG = {
    host: "ftp.inventionminds.com",  // Your FTP hostname
    user: "u948610439",       // Your FTP username
    password: "Bsrenuk@1993",   // Your FTP password
    secure: false                    // Set to true if using FTPS
};



export const createEstimation = async (req: Request, res: Response) => {
    try {
        const { doctorId, departmentId, estimation, estimationType } = req.body;
        const savedEstimation = await prisma.estimation.create({
            data: {
                doctorId,
                departmentId,
                estimation,
                estimationType
            },
        });
        res.status(201).json({
            message: 'Estimation saved successfully',
            estimation: savedEstimation,
        });
    }
    catch (error) {
        console.error('Error during create estimation:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
export const getEstimationsByDepartment = async (req: Request, res: Response) => {
    try {
        const { departmentId, estimationType } = req.params;

        // Fetch estimations for the given department ID
        const estimations = await prisma.estimation.findMany({
            where: {
                departmentId: Number(departmentId),
                estimationType: (estimationType)
            },
            select: {
                estimation: true,
            },
        });

        res.status(200).json(estimations.map((e) => e.estimation));
    } catch (error) {
        console.error('Error fetching estimations by department:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
export const getEstimationsByType = async (req: Request, res: Response) => {
    try {
        const { estimationType } = req.params;

        // Fetch estimations for the given department ID
        const estimations = await prisma.estimation.findMany({
            where: {
                estimationType: (estimationType)
            },
            select: {
                estimation: true,
            },
        });

        res.status(200).json(estimations.map((e) => e.estimation));
    } catch (error) {
        console.error('Error fetching estimations by department:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createEstimationDetails = async (req: Request, res: Response) => {
    try {
        const {
            prnNumber,
            patientName,
            phoneNumber,
            estimationName,
            preferredDate,
            doctorId,
            doctorName,
            status,
            estimationType,
            estimationCreatedTime,
            remarks,
            surgeryTime,
            totalDaysStay,
            icuStay,
            wardStay,
            surgeryPackage,
            estimationStatus
        } = req.body;

        const lastEstimation = await prisma.estimationDetails.findFirst({
            orderBy: { id: 'desc' }, // Order by ID descending to get the latest record
        });

        // Extract the last number from the estimationId (if any)
        let nextNumber = 1;
        if (lastEstimation && lastEstimation.estimationId) {
            const match = lastEstimation.estimationId.match(/(\d+)$/); // Extract the numeric part
            if (match) {
                nextNumber = parseInt(match[1], 10) + 1; // Increment the number
            }
        }
        const currentYear = new Date().getFullYear();
        const fiscalYear = `${currentYear - 1}/${currentYear % 100}`;
        const estimationIdPrefix = `JMRH FY${fiscalYear}`;
        const estimationId = `${estimationIdPrefix} - ${nextNumber.toString().padStart(3, '0')}`;

        const estimationDetails = await prisma.estimationDetails.create({
            data: {
                estimationId: estimationId,
                patientUHID: prnNumber,
                patientName,
                patientPhoneNumber: phoneNumber,
                estimationName,
                estimationPreferredDate: preferredDate,
                consultantId: doctorId,
                consultantName: doctorName,
                statusOfEstimation: status,
                estimationType,
                remarks,
                estimationCreatedTime,
                surgeryTime,
                totalDaysStay,
                icuStay,
                wardStay,
                surgeryPackage,
                estimationStatus
            },
        });
        const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
        const url = process.env.WHATSAPP_API_URL_BULK;
        console.log(estimationId)
        const payload = {
            from: fromPhoneNumber,
            // to: ["919844171700", "916364833989", "918904943659"], // Recipient's WhatsApp number
            to: ["919342287945"],
            type: "template",
            message: {
                templateid: "739377", // Use your actual template ID // Extracts PDF name
                placeholders: [doctorName, patientName]
            }
        };

        const headers = {
            "Content-Type": "application/json",
            apikey: process.env.WHATSAPP_AUTH_TOKEN, // API key from Pinnacle
        };

        const response = await axios.post(url!, payload, { headers });
        const newNotification = await prisma.notification.create({
            data: {

                type: 'estimation_request',
                title: 'New Estimation Raised',
                message: `${doctorName} has raised an estimation. Please review the details`,
                entityType: 'estimation',
                isCritical: false,
                targetRole: 'sub_admin',
            },
        });

        if (estimationDetails.estimationStatus === 'immediate') {
            try {
                const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
                const url = process.env.WHATSAPP_API_URL_BULK;
                console.log(estimationId)
                const payload = {
                    from: fromPhoneNumber,
                    // to: ["919844171700", "916364833989", "918904943659"], // Recipient's WhatsApp number
                    to: ["919342287945"],
                    type: "template",
                    message: {
                        templateid: "739341", // Use your actual template ID // Extracts PDF name
                        placeholders: [doctorName, patientName, prnNumber]
                    }
                };

                const headers = {
                    "Content-Type": "application/json",
                    apikey: process.env.WHATSAPP_AUTH_TOKEN, // API key from Pinnacle
                };

                const response = await axios.post(url!, payload, { headers });

                if (response.data.code === "200") {
                    console.log("✅ WhatsApp message sent successfully:", response.data);
                    response;
                    return
                } else {
                    console.error("❌ Failed to send WhatsApp message:", response.data);
                    throw new Error("WhatsApp API failed");
                }
            } catch (error) {
                console.error("❌ WhatsApp API Error:", error);
                throw error;
            }
        }
        console.log("New Notification:", newNotification);
        notifyPendingAppointments(newNotification);

        res.status(201).json({
            message: 'Estimation Details created successfully',
            estimationDetails,
        });
    } catch (error) {
        console.error('Error creating estimation details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
export const createNewEstimationDetails = async (req: Request, res: Response) => {
    try {

        const {
            updateFields, // Dynamic object with fields to update
            inclusions, // Array of inclusion names
            exclusions, // Array of exclusion names
        } = req.body;
        const {
            patientUHID,
            patientName,
            estimationName,
            statusOfEstimation,
            estimationType,
            ageOfPatient,
            genderOfPatient,
            consultantName,
            consultantId,
            icuStay,
            wardStay,
            estimationCost,
            remarks,
            roomType,
            estimatedDate,
            discountPercentage,
            totalEstimationAmount,
            patientPhoneNumber,
            signatureOf,
            employeeName,
            approverName,
            patientSign,
            employeeSign,
            approverSign,
            employeeId,
            approverId,
            totalDaysStay,
            surgeryTime,
            surgeryPackage,
            implants,
            instrumentals,
            procedures,
            multipleEstimationCost,
            costForGeneral,
            costForPrivate,
            costForSemiPrivate,
            costForVip,
            costForDeluxe,
            costForPresidential,
            selectedRoomCost,
            patientRemarks,
            staffRemarks,
        } = updateFields;

        const lastEstimation = await prisma.estimationDetails.findFirst({
            orderBy: { id: 'desc' }, // Order by ID descending to get the latest record
        });

        // Extract the last number from the estimationId (if any)
        let nextNumber = 1;
        if (lastEstimation && lastEstimation.estimationId) {
            const match = lastEstimation.estimationId.match(/(\d+)$/); // Extract the numeric part
            if (match) {
                nextNumber = parseInt(match[1], 10) + 1; // Increment the number
            }
        }
        const currentYear = new Date().getFullYear();
        const fiscalYear = `${currentYear - 1}/${currentYear % 100}`;
        const estimationIdPrefix = `JMRH FY${fiscalYear}`;
        const estimationId = `${estimationIdPrefix} - ${nextNumber.toString().padStart(3, '0')}`;
        console.log("Implants:", implants);
        console.log("Procedures:", procedures);
        console.log("Instrumentals:", instrumentals);
        // Create the estimation details
        const estimationDetails = await prisma.estimationDetails.create({
            data: {
                estimationId: estimationId,
                patientUHID: patientUHID,
                patientName: patientName,
                patientPhoneNumber: patientPhoneNumber,
                estimationName,
                estimationPreferredDate: "",
                statusOfEstimation: statusOfEstimation,
                consultantId,
                consultantName,
                estimationType,
                ageOfPatient,
                genderOfPatient,
                icuStay,
                wardStay,
                estimationCost,
                remarks,
                roomType,
                estimatedDate,
                discountPercentage,
                totalEstimationAmount,
                signatureOf,
                employeeName,
                approverName,
                patientSign,
                employeeSign,
                approverSign,
                employeeId,
                approverId,
                totalDaysStay,
                surgeryTime,
                surgeryPackage,
                procedures,
                instrumentals,
                implants,
                multipleEstimationCost,
                costForGeneral,
                costForPrivate,
                costForSemiPrivate,
                costForVip,
                costForDeluxe,
                costForPresidential,
                selectedRoomCost,
                patientRemarks,
                staffRemarks,
            },
        });

        // Create inclusions
        if (inclusions && Array.isArray(inclusions)) {
            await prisma.inclusion.createMany({
                data: inclusions.map((description: string) => ({
                    description,
                    estimationId: estimationDetails.estimationId,
                })),
            });
        }

        // Create exclusions
        if (exclusions && Array.isArray(exclusions)) {
            await prisma.exclusion.createMany({
                data: exclusions.map((description: string) => ({
                    description,
                    estimationId: estimationDetails.estimationId,
                })),
            });
        }

        res.status(201).json({
            message: 'Estimation Details created successfully',
            estimationDetails,
        });
    } catch (error) {
        console.error('Error creating estimation details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getAllEstimationDetails = async (req: Request, res: Response) => {
    try {
        const estimationDetails = await prisma.estimationDetails.findMany({
            include: {
                inclusions: true,
                exclusions: true,
                followUpDates: true
            }
        });

        res.status(200).json(estimationDetails);
    } catch (error) {
        console.error('Error fetching estimation details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateEstimationDetails = async (req: Request, res: Response) => {
    try {
        const { estimationId } = req.params;
        const {
            updateFields, // Dynamic object with fields to update
            inclusions, // Array of inclusion names
            exclusions, // Array of exclusion names
        } = req.body;

        // Validate if `estimationId` exists
        const existingEstimation = await prisma.estimationDetails.findUnique({
            where: { estimationId },
        });

        if (!existingEstimation) {
            res.status(404).json({ message: 'Estimation not found' });
            return
        }

        if (updateFields.statusOfEstimation === 'submitted') {
            updateFields.submittedDateAndTime = new Date()
        }

        // Update dynamic fields
        const updatedEstimation = await prisma.estimationDetails.update({
            where: { estimationId },
            data: updateFields, // Pass the fields dynamically
        });

        // Handle updating inclusions
        if (inclusions && Array.isArray(inclusions)) {
            await prisma.inclusion.deleteMany({ where: { estimationId } }); // Use estimationId directly
            await prisma.inclusion.createMany({
                data: inclusions.map((name: string) => ({
                    description: name, // Assuming `description` is the field name for inclusion
                    estimationId, // Use estimationId directly
                })),
            });
        }

        // Handle updating exclusions
        if (exclusions && Array.isArray(exclusions)) {
            await prisma.exclusion.deleteMany({ where: { estimationId } }); // Use estimationId directly
            await prisma.exclusion.createMany({
                data: exclusions.map((name: string) => ({
                    description: name, // Assuming `description` is the field name for exclusion
                    estimationId, // Use estimationId directly
                })),
            });
        }
        const newNotification = await prisma.notification.create({
            data: {

                type: 'estimation_request',
                title: 'Estimation Submitted for Approval',
                message: `An estimation is currently awaiting approval. Please review and approve the details.`,
                entityType: 'estimation',
                isCritical: false,
                targetRole: 'admin',
            },
        });
        console.log("New Notification:", newNotification);
        notifyPendingAppointments(newNotification);

        res.status(200).json({
            message: 'Estimation updated successfully',
            updatedEstimation,
        });
    } catch (error) {
        console.error('Error updating estimation details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateFollowUps = async (req: Request, res: Response) => {
    try {
        const { estimationId } = req.params; // Extract the estimationId from the route params
        const { followUpData, date, remarks } = req.body; // Extract follow-up data from the request body
        console.log(followUpData, date, remarks)
        // const date = followUpData.date;
        // const remarks = followUpData.remarks;
        // Validate if the estimation exists
        const estimation = await prisma.estimationDetails.findUnique({
            where: { estimationId },
            include: { followUpDates: true }, // Include follow-ups for validation
        });

        if (!estimation) {
            res.status(404).json({ message: 'Estimation not found' });
            return
        }

        // Validate if there are already 5 follow-ups
        if (estimation.followUpDates.length >= 5) {
            res.status(400).json({ message: 'Maximum of 5 follow-ups allowed' });
            return
        }

        // Add the new follow-up
        const newFollowUp = await prisma.followUpDate.create({
            data: {
                date,
                remarks,
                estimationId,
            },
        });

        res.status(200).json({
            message: 'Follow-up added successfully',
            followUp: newFollowUp,
        });
    } catch (error) {
        console.error('Error updating follow-ups:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
export const updateAdvanceDetails = async (req: Request, res: Response) => {
    try {
        const { estimationId } = req.params; // Get estimationId from URL params
        const { advanceAmountPaid, receiptNumber } = req.body; // Get advance amount and receipt number from request body
        console.log(advanceAmountPaid, receiptNumber)

        // Validate if estimation exists
        const existingEstimation = await prisma.estimationDetails.findUnique({
            where: { estimationId },
        });

        if (!existingEstimation) {
            res.status(404).json({ message: "Estimation not found" });
            return
        }

        // Update the advance amount and receipt number
        const updatedEstimation = await prisma.estimationDetails.update({
            where: { estimationId },
            data: {
                advanceAmountPaid,
                receiptNumber,
                statusOfEstimation: 'confirmed',
                confirmedDateAndTime: new Date()
            },
        });

        res.status(200).json({
            message: "Advance details updated successfully",
            updatedEstimation,
        });
    } catch (error) {
        console.error("Error updating advance details:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
function formatDateYear(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
    const year = date.getFullYear().toString().slice(-4); // Get last two digits of year
    return `${day}-${month}-${year}`;
}
export const markComplete = async (req: Request, res: Response) => {
    try {
        const { estimationId } = req.params; // Get estimationId from URL params
        const { statusOfEstimation } = req.body; // Get advance amount and receipt number from request body
        console.log(statusOfEstimation)
        const existingEstimation = await prisma.estimationDetails.findUnique({
            where: { estimationId },
        });

        if (!existingEstimation) {
            res.status(404).json({ message: "Estimation not found" });
            return
        }
        const updatedEstimation = await prisma.estimationDetails.update({
            where: { estimationId },
            data: {
                statusOfEstimation: 'completed',
                completedDateAndTime: new Date()
            },

        });
        res.status(200).json(updatedEstimation);
        try {
            const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
            const url = process.env.WHATSAPP_API_URL;
            console.log(existingEstimation.patientName)
            const payload = {
                from: fromPhoneNumber,
                to: existingEstimation.patientPhoneNumber, // Recipient's WhatsApp number
                type: "template",
                message: {
                    templateid: "726905",  // Ensure this template ID is valid for Admins
                    placeholders: [existingEstimation.patientName],
                },
            };

            const headers = {
                "Content-Type": "application/json",
                apikey: process.env.WHATSAPP_AUTH_TOKEN, // API key from Pinnacle
            };

            const response = await axios.post(url!, payload, { headers });


        } catch (error) {
            console.error("❌ WhatsApp API Error:", error);
            throw error;
        }



    } catch (error) {
        console.error("Error updating complete estimation details:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}
export const updateFeedback = async (req: Request, res: Response) => {
    try {
        const { estimationId } = req.params; // Get estimationId from URL params
        const { cancellerId, cancellerName, feedback } = req.body;

        const existingEstimation = await prisma.estimationDetails.findUnique({
            where: { estimationId },
        });

        if (!existingEstimation) {
            res.status(404).json({ message: "Estimation not found" });
            return
        }
        const updatedEstimation = await prisma.estimationDetails.update({
            where: { estimationId },
            data: {
                cancellerId: cancellerId,
                cancellerName: cancellerName,
                cancellationDateAndTime: new Date(),
                statusOfEstimation: 'cancelled',
                feedback: feedback
            }

        });

        res.status(200).json(updatedEstimation);
        try {
            const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
            const url = process.env.WHATSAPP_API_URL;
            console.log(existingEstimation.patientName)
            const payload = {
                from: fromPhoneNumber,
                to: existingEstimation.patientPhoneNumber, // Recipient's WhatsApp number
                type: "template",
                message: {
                    templateid: "726909",  // Ensure this template ID is valid for Admins
                    placeholders: [existingEstimation.patientName],
                },
            };

            const headers = {
                "Content-Type": "application/json",
                apikey: process.env.WHATSAPP_AUTH_TOKEN, // API key from Pinnacle
            };

            const response = await axios.post(url!, payload, { headers });

        } catch (error) {
            console.error("❌ WhatsApp API Error:", error);
            throw error;
        }


    } catch (error) {
        console.error("Error updating complete estimation details:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}

export const updatePACDone = async (req: Request, res: Response) => {
    try {
        const { estimationId } = req.params; // Get estimationId from URL params
        const { updateFields } = req.body;
        console.log(updateFields.pacAmountPaid, updateFields.pacReceiptNumber)
        const existingEstimation = await prisma.estimationDetails.findUnique({
            where: { estimationId },
        });

        if (!existingEstimation) {
            res.status(404).json({ message: "Estimation not found" });
            return
        }
        const updatedEstimation = await prisma.estimationDetails.update({
            where: { estimationId },
            data: {
                pacDone: true,
                pacAmountPaid: updateFields.pacAmountPaid,
                pacReceiptNumber: updateFields.pacReceiptNumber
            }

        });
        res.status(200).json(updatedEstimation);


    } catch (error) {
        console.error("Error updating complete estimation details:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}

async function uploadToFTP(localFilePath: any, remoteFilePath: any) {
    const client = new Client();
    client.ftp.verbose = true; // Optional: Logs FTP operations

    try {
        await client.access(FTP_CONFIG);
        console.log("Connected to FTP Server!");

        // Ensure the "pdfs" directory exists
        await client.ensureDir("/docminds/pdfs");

        // Upload the file
        await client.uploadFrom(localFilePath, remoteFilePath);
        console.log(`Uploaded: ${remoteFilePath}`);

        await client.close();
    } catch (error) {
        console.error("FTP Upload Error:", error);
    }
}
export const generateEstimationPDF = async (req: Request, res: Response) => {
    try {
        const {
            estimationId,
            inclusions,
            exclusions,
            updateFields,
        } = req.body;
        console.log(estimationId, inclusions, exclusions)
        const {
            patientUHID,
            patientName,
            ageOfPatient,
            genderOfPatient,
            consultantName,
            estimationPreferredDate,
            estimationName,
            icuStay,
            wardStay,
            totalDaysStay,
            roomType,
            estimatedDate,
            discountPercentage,
            estimationCost,
            totalEstimationAmount,
            patientSign,
            employeeSign,
            approverSign,
            approverName,
            employeeName,
            patientPhoneNumber,
            signatureOf,
            implants,
            procedures,
            instrumentals,
            surgeryPackage,
            attenderName,
            patientRemarks,
            multipleEstimationCost,
            costForGeneral,
            costForPrivate,
            costForSemiPrivate,
            costForVip,
            costForDeluxe,
            costForPresidential,
            selectedRoomCost,
        } = updateFields

        // Validate that estimationId is provided
        if (!estimationId) {
            res.status(400).json({ error: "Estimation ID is required" });
            return;
        }
        // const pdfDirectory = path.join(__dirname, "../../generated_pdfs");
        const pdfDirectory = "/home/u948610439/domains/inventionminds.com/public_html/docminds/pdfs";
        // if (!fs.existsSync(pdfDirectory)) {
        //     fs.mkdirSync(pdfDirectory, { recursive: true });
        // }

        // Sanitize the file name
        const sanitizedEstimationId = estimationId.replace(/[\/\\:*?"<>|]/g, "_");
        // const filePath = path.join(pdfDirectory, `Estimation_${sanitizedEstimationId}.pdf`);
        const fileName = `Estimation_${sanitizedEstimationId}.pdf`;

        // Temporary local file path (will be uploaded via FTP and deleted)
        const tempFilePath = path.join(__dirname, fileName);
        const doc = new PDFDocument({ size: "A4", margin: 20 });

        // File to save the PDF

        const writeStream = fs.createWriteStream(tempFilePath);

        // Pipe the document to a file
        doc.pipe(writeStream);

        // Add background image (uploaded template)
        const poppinsFontPath = path.join(__dirname, '../../assets/Poppins-Regular.ttf');
        const poppinsMedium = path.join(__dirname, '../../assets/Poppins-Medium.ttf');
        const poppinsSemiBold = path.join(__dirname, '../../assets/Poppins-SemiBold.ttf')

        const templatePath = path.join(__dirname, '../../assets/JMRH Estimation Form.png');


        // const templatePath = "E:/Hospital_Appointment_Admin_Panel_Backend/JMRH Estimation Form.png"; // Path to your uploaded PNG
        if (fs.existsSync(templatePath)) {
            doc.image(templatePath, 0, 0, { width: doc.page.width, height: doc.page.height });
        } else {
            console.warn(`Template file not found at: ${templatePath}`);
        }

        // Embed data into the form
        // const poppinsFontPath = "E:/Hospital_Appointment_Admin_Panel_Backend/Poppins-Regular.ttf"; // Absolute path
        // or if using relative paths:
        // const poppinsFontPath = path.join(__dirname, "fonts", "Poppins-SemiBold.ttf");

        // Register and use the font
        doc.registerFont("Poppins-Regular", poppinsFontPath);

        // const poppinsMedium = "E:/Hospital_Appointment_Admin_Panel_Backend/Poppins-Medium.ttf"
        doc.registerFont("Poppins-Medium", poppinsMedium);
        doc.registerFont("Poppins-SemiBold", poppinsSemiBold)

        doc.fontSize(12).fillColor("black");

        // Patient Information
        doc.text(`${estimationId || "N/A"}`, 432, 88)
        doc.font("Poppins-Regular").text(` ${patientUHID || "N/A"}`, 100, 126);
        doc.text(`${patientName || "N/A"}`, 100, 150);
        doc.text(`${ageOfPatient || "N/A"}`, 382, 126);
        doc.text(` ${genderOfPatient || "N/A"}`, 380, 150);

        // Consultant Information
        doc.text(`${consultantName || "N/A"}`, 150, 196);
        doc.text(` ${estimationPreferredDate || "N/A"}`, 422, 196);
        doc.text(` ${estimationName || "N/A"}`, 148, 220);

        // Stay Details
        doc.text(` ${icuStay || "N/A"}`, 412, 248);
        doc.text(`${wardStay || "N/A"}`, 540, 248);
        doc.text(`${totalDaysStay || "N/A"}`, 306, 248);

        // Room Type
        // doc.fontSize(10).text(`Selected Ward: ${selectedRoomCost || "N/A"}`, 43, 270);
        // Define available cost fields
        const costFields = {
            General: costForGeneral,
            Private: costForPrivate,
            SemiPrivate: costForSemiPrivate,
            VIP: costForVip,
            Deluxe: costForDeluxe,
            Presidential: costForPresidential
        };
        
        // Example estimation names (split if there are multiple surgeries)
        const estimationNames = estimationName ? estimationName.split(',') : [];
        
        // Adjust initial position for displaying room costs
        let yPosition = 290;
        let index = 0; // Index for numbering room types
        
        // // Iterate over available costs and format them correctly
        // Object.entries(costFields).forEach(([key, value]) => {
        //     if (value) {
        //         const costs = value.split(','); // Split costs by comma
        //         doc.text(`${index} - ${key}:`, 43, yPosition); // Print room type
        //         yPosition += 15;
        
        //         // Assign surgery names to each cost, if available
        //         costs.forEach((cost:any, costIndex:any) => {
        //             let surgeryLabel = estimationNames[costIndex] ? estimationNames[costIndex].trim() : `Cost ${costIndex + 1}`;
        //             doc.text(`${surgeryLabel} cost: $${cost.trim()}`, 60, yPosition);
        //             yPosition += 15; // Move to the next line
        //         });
        
        //         index++; // Increment index for room type numbering
        //         yPosition += 5; // Extra spacing between room types
        //     }
        // });
        // Iterate over available costs and format them correctly
Object.entries(costFields).forEach(([key, value]) => {
    if (value) {
        const costs = value.split(','); // Split costs by comma

        // Assign surgery names or default cost labels
        const formattedCosts = costs.map((cost:any, costIndex:any) => {
            let surgeryLabel = estimationNames[costIndex] ? estimationNames[costIndex].trim().trim().toUpperCase() : `Cost ${costIndex + 1}`;
            return `${surgeryLabel} cost: ₹${cost.trim()}`;
        });

        doc.fillColor("#0098A3").font('Poppins-SemiBold').text(`${key}:`, 43, yPosition, { continued: false });
        
        // Set font to semi-bold before printing surgery labels
        doc.font('Poppins-SemiBold'); // Use a semi-bold font
        doc.fillColor("black").text(formattedCosts.join(', '), 120, yPosition, { continued: false });
        yPosition += 15; // Move to next line for the next room type

        index++; // Increment index for room type numbering
    }
});



        // doc.text(` ${costForGeneral || "N/A"}`, 43, 275);
        doc.fontSize(8).font('Poppins-Regular').text(`Note: The cost of the room includes daily nursing and diet fees`, 43, 345);
        doc.fillColor("#0098A3").font('Poppins-SemiBold').fontSize(14).text(`Inclusion: `, 30, 375);

        // Inclusions & Exclusions
        // doc.text(`${inclusions.length > 0 ? inclusions.map((i: any) => i.description).join(", ") : "None"}`, 50, 426);
        // doc.text(` ${exclusions.length > 0 ? exclusions.map((e: any) => e.description).join(", ") : "None"}`, 50, 516);

        const startX = 30;  // X position of first column
        const columnWidth = 130; // Space between columns
        const startY = 395;
        const lineHeight = 20;
        const columns = 4;
        function formatWithSpaces(text: string): string {
            return text.replace(/([a-z])([A-Z])/g, '$1 $2'); // Insert space before uppercase letters
        }
        // Split inclusions into 4 parts
        const itemsPerColumn = Math.ceil(inclusions.length / columns);
        const inclusionsColumns = [
            inclusions.slice(0, itemsPerColumn),
            inclusions.slice(itemsPerColumn, itemsPerColumn * 2),
            inclusions.slice(itemsPerColumn * 2, itemsPerColumn * 3),
            inclusions.slice(itemsPerColumn * 3)
        ];
        let num = 1
        // Render inclusions in 4 columns
        inclusionsColumns.forEach((column, colIndex) => {
            column.forEach((item: string, rowIndex: number) => {
                if (item) { // Ensure item exists
                    const xPos = startX + (colIndex * columnWidth);
                    const yPos = startY + (rowIndex * lineHeight);
                    const formattedItem = formatWithSpaces(item);

                    doc.fontSize(10).fillColor("black").font('Poppins-Regular')
                        .text(`${num}. ${formattedItem.charAt(0).toUpperCase() + formattedItem.slice(1)}`, xPos, yPos);

                    num++; // Increment global number
                } else {
                    console.warn("Skipping an invalid inclusion item:", item); // Log skipped items
                }
            });
        });

        doc.fillColor("#0098A3").font('Poppins-SemiBold').fontSize(14).text(`Exclusions: `, 30, 455);

        const startExclusionsY = 480;

        // Split exclusions into 4 parts
        const exclusionsPerColumn = Math.ceil(exclusions.length / columns);
        const exclusionsColumns = [
            exclusions.slice(0, exclusionsPerColumn),
            exclusions.slice(exclusionsPerColumn, exclusionsPerColumn * 2),
            exclusions.slice(exclusionsPerColumn * 2, exclusionsPerColumn * 3),
            exclusions.slice(exclusionsPerColumn * 3)
        ];

        // Render exclusions in 4 columns
        let exclusionNum = 1
        exclusionsColumns.forEach((column, colIndex) => {
            column.forEach((item: string, rowIndex: number) => {
                if (item) { // Ensure item exists

                    const xPos = startX + (colIndex * columnWidth);
                    const yPos = startExclusionsY + (rowIndex * lineHeight);
                    const formattedItem = formatWithSpaces(item);

                    doc.fontSize(10)
                        .fillColor("black")
                        .font('Poppins-Regular')
                        .text(`${exclusionNum}. ${formattedItem.charAt(0).toUpperCase() + formattedItem.slice(1)}`, xPos, yPos);
                    exclusionNum++;
                } else {
                    console.warn("Skipping an invalid inclusion item:", item); // Log skipped items
                }
            });
        });
        const itemsStartY = startExclusionsY + (exclusionsPerColumn + 2) * lineHeight;

        doc.fontSize(12).text(`Implants: ${implants || "N/A"}`, 30, 547);
        doc.fontSize(12).text(`Procedures: ${procedures || "N/A"}`, 30, 567);
        doc.fontSize(12).text(`Instruments: ${instrumentals || "N/A"}`, 30, 589);
        doc.fontSize(12).text(`Patient Remarks: ${patientRemarks || "N/A"}`, 30, 608)

        // Set color for "Surgery Procedure:" label
        // doc.fillColor("#0098A3").font('Poppins-SemiBold').text("Surgery Procedure: ", 30, 605, { continued: true });

        // Reset color for the dynamic value (surgeryPackage)
        // doc.fillColor("black").font("Poppins-Regular").fontSize(12).text(`${surgeryPackage || "N/A"}`);

        if (surgeryPackage?.toLowerCase() === "multiple surgeries") {
            doc.text(`Multiple Surgery Cost: ${multipleEstimationCost || "N/A"}`, 30, 625);
        }
        // Estimation Details
        doc.text(`Estimated Date: ${estimatedDate || "N/A"}`, 30, 645);
        // doc.text(`Discount: ${discountPercentage || ""}`, 300, 645);
        doc.text(`Selected Ward: ${selectedRoomCost || "N/A"}`, 300, 645);
        doc.fillColor("black").font('Poppins-SemiBold').fontSize(12).text(`Estimation Cost: ${estimationCost || 0}`, 30, 670);
        doc.fillColor("black").font('Poppins-SemiBold').fontSize(12).text(`Total Cost: ${totalEstimationAmount || 0}`, 300, 670);

        // Signatures
        doc.fillColor("#213043").font("Poppins-Medium").text(`${signatureOf ? signatureOf.charAt(0).toUpperCase() + signatureOf.slice(1).toLowerCase() : "N/A"}`, 88, 696);


        const addImageFromBase64 = async (
            doc: PDFKit.PDFDocument,
            base64: string,
            x: number,
            y: number,
            width: number,
            height: number
        ) => {
            try {
                if (base64.startsWith("data:image/png;base64,")) {
                    // Decode Base64 and process it using sharp
                    const imageBuffer = Buffer.from(base64.split(",")[1], "base64");

                    // Ensure the image is a valid PNG using sharp
                    const processedImageBuffer = await sharp(imageBuffer)
                        .png()
                        .toBuffer();

                    // Create a temporary file (fallback for pdfkit)
                    const tempFilePath = path.join(__dirname, `temp_${Date.now()}.png`);
                    fs.writeFileSync(tempFilePath, processedImageBuffer);

                    // Add the image to the PDF
                    doc.image(tempFilePath, x, y, { width, height });

                    // Clean up the temporary file
                    fs.unlinkSync(tempFilePath);
                } else {
                    console.error("Invalid Base64 image format");
                    doc.text("Signature Missing", x, y + height / 2);
                }
            } catch (error) {
                if (error instanceof Error) {
                    console.error("Error adding image:", error.message);
                } else {
                    console.error("Unknown error occurred.");
                }
                doc.text("Signature Missing", x, y + height / 2);
            }
        };

        // Usage example in your PDF generation code
        if (patientSign) {
            await addImageFromBase64(doc, patientSign, 50, 715, 60, 30);
        }
        if (employeeSign) {
            await addImageFromBase64(doc, employeeSign, 250, 715, 60, 30);
        }
        if (approverSign) {
            await addImageFromBase64(doc, approverSign, 450, 715, 60, 30);
        }

        doc.text(`${signatureOf === "patient" ? patientName : attenderName || "N/A"}`, 55, 755)
        doc.text(` ${employeeName || "N/A"}`, 244, 755);
        doc.text(`${approverName || "N/A"}`, 440, 755);

        // End the document
        doc.end();

        writeStream.on("finish", async () => {
            const remoteFilePath = `/public_html/docminds/pdfs/${fileName}`;
            await uploadToFTP(tempFilePath, remoteFilePath);
            const pdfUrl = `https://docminds.inventionminds.com/pdfs/Estimation_${sanitizedEstimationId}.pdf`;

            // Save PDF details to the database (assuming you have a function for this)
            await savePdfToDatabase(estimationId, pdfUrl);

            // Delete the local file after upload
            fs.unlinkSync(tempFilePath);
            const whatsappResponse = await sendWhatsAppMessage(patientPhoneNumber, pdfUrl, patientName, estimationId);

            res.status(200).json({
                success: true,
                message: "PDF generated & sent via WhatsApp successfully.",
                filePath: pdfUrl,
                whatsappResponse: whatsappResponse.data // Include WhatsApp API response
            });
        });

        writeStream.on("error", (error) => {
            console.error("Error writing PDF:", error);
            res.status(500).json({ error: "Failed to write PDF file." });
        });
    } catch (error) {
        console.error("Error generating PDF:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};




// 📌 Draw Table Function
function drawTable(doc:any, rows:any, startX:any, startY:any) {
    rows.forEach(([label, value]:any, i:any) => {
        doc.font("Poppins-Bold").fontSize(10).text(label, startX, startY + i * 15);
        doc.font("Poppins-Regular").text(value, startX + 150, startY + i * 15);
    });
}

// 📌 Function to Add Images (Base64)
async function addImageFromBase64(doc:any, base64:any, x:any, y:any, width:any, height:any, label:any) {
    if (!base64) {
        doc.text("N/A", x, y + height / 2);
        return;
    }
    try {
        const imageBuffer = Buffer.from(base64.split(",")[1], "base64");
        const processedImageBuffer = await sharp(imageBuffer).png().toBuffer();
        const tempFilePath = path.join(__dirname, `temp_${Date.now()}.png`);
        fs.writeFileSync(tempFilePath, processedImageBuffer);
        doc.image(tempFilePath, x, y, { width, height });
        fs.unlinkSync(tempFilePath);
    } catch (error) {
        doc.text("Signature Missing", x, y + height / 2);
    }
}

async function savePdfToDatabase(estimationId: string, pdfUrl: string) {
    try {
        await prisma.estimationDetails.update({
            where: { estimationId: estimationId }, // Ensure correct structure
            data: { pdfLink: pdfUrl } // This should be an object with the field name
        });
        console.log("PDF URL saved to database");
    } catch (error) {
        console.error("Error saving PDF URL:", error);
    }
}
import axios from "axios";

async function sendWhatsAppMessage(patientPhoneNumber: string, pdfUrl: string, patientName: string, estimationId: string) {
    try {
        const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
        const url = process.env.WHATSAPP_API_URL;
        console.log(patientName)
        const payload = {
            from: fromPhoneNumber,
            to: patientPhoneNumber, // Recipient's WhatsApp number
            type: "template",
            message: {
                templateid: "715873", // Use your actual template ID
                url: pdfUrl,
                caption: "Here is your estimation document.",
                filename: pdfUrl.split("/").pop(), // Extracts PDF name
                placeholders: [patientName]
            }
        };

        const headers = {
            "Content-Type": "application/json",
            apikey: process.env.WHATSAPP_AUTH_TOKEN, // API key from Pinnacle
        };

        const response = await axios.post(url!, payload, { headers });

        if (response.data.code === "200") {
            console.log("✅ WhatsApp message sent successfully:", response.data);
            await prisma.estimationDetails.update({
                where: { estimationId: estimationId }, // Ensure correct structure
                data: {
                    messageSent: true,
                    messageSentDateAndTime: new Date()
                } // This should be an object with the field name

            });
            return response;
        } else {
            console.error("❌ Failed to send WhatsApp message:", response.data);
            throw new Error("WhatsApp API failed");
        }
    } catch (error) {
        console.error("❌ WhatsApp API Error:", error);
        throw error;
    }
}

export const lockService = async (req: Request, res: Response): Promise<void> => {
    try {
        const serviceId = Number(req.params.id);
        const userId = Number(req.body.userId);

        if (!serviceId || isNaN(serviceId) || !userId || isNaN(userId)) {
            res.status(400).json({ message: 'Invalid service ID or user ID' });
            return;
        }

        const estimation = await prisma.estimationDetails.findUnique({
            where: {
                id: serviceId
            }
        });
        if (!estimation) {
            res.status(404).json({ message: 'Service not found' });
            return;
        }

        if (estimation.lockedBy && estimation.lockedBy !== userId) {
            res.status(409).json({ message: 'Service is locked by another user' });
            return;
        }

        const lockedService = await prisma.estimationDetails.update({
            where: { id: serviceId },
            data: { lockedBy: userId },
        });
        res.status(200).json(lockedService);
    } catch (error) {
        console.error('Error locking service:', error);
        res.status(500).json({ message: 'Failed to lock service' });
    }
};

export const unlockService = async (req: Request, res: Response): Promise<void> => {
    try {
        const serviceId = Number(req.params.id);

        if (!serviceId || isNaN(serviceId)) {
            res.status(400).json({ message: 'Invalid service ID' });
            return;
        }

        const unlockedService = await prisma.estimationDetails.update({
            where: { id: serviceId },
            data: { lockedBy: null },
        });
        res.status(200).json(unlockedService);
    } catch (error) {
        console.error('Error unlocking service:', error);
        res.status(500).json({ message: 'Failed to unlock service' });
    }
};

