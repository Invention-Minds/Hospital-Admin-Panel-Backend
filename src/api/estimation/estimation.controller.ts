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
    host: "srv680.main-hosting.eu",  // Your FTP hostname
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
            estimationStatus,
            patientEmail,
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
                estimationStatus,
                patientEmail
            },
        });
        const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
        const url = process.env.WHATSAPP_API_URL_BULK;
        console.log(estimationId)
        const payload = {
            from: fromPhoneNumber,
            to: ["919844171700", "916364833989", "918904943659","917760158457", "918147818482"], // Recipient's WhatsApp number
            // to: ["919342287945"],
            // to:['919342003000'],
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
                    to: ["919844171700", "916364833989", "918904943659","917760158457", "918147818482"], // Recipient's WhatsApp number
                    // to: ["919342287945"],
                    // to:['919342003000'],
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
            patientEmail,
            submittedDateAndTime
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
                patientEmail,
                submittedDateAndTime: new Date()
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
        if (updateFields.statusOfEstimation === 'rejected') {
            try {
                const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
                const url = process.env.WHATSAPP_API_URL;
                console.log(existingEstimation.patientName)
                const payload = {
                    from: fromPhoneNumber,
                    to: existingEstimation.patientPhoneNumber, // Recipient's WhatsApp number
                    type: "template",
                    message: {
                        templateid: "796857",  // Ensure this template ID is valid for Admins
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
        }
        if (existingEstimation.statusOfEstimation === 'submitted') {
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
        }

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
                completedDateAndTime: new Date(),
                messageSent: true,
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
                pacReceiptNumber: updateFields.pacReceiptNumber,
                statusOfEstimation: 'confirmed',
                confirmedDateAndTime: new Date()
            }

        });
        res.status(200).json(updatedEstimation);


    } catch (error) {
        console.error("Error updating complete estimation details:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}

export const estConfirm = async (req: Request, res: Response) => {
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
                statusOfEstimation: 'confirmed',
                confirmedDateAndTime: new Date()
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
        // await client.ensureDir("/docminds/pdfs");
        await client.ensureDir("/docminds/demo_pdfs");

        // Upload the file
        await client.uploadFrom(localFilePath, remoteFilePath);
        console.log(`Uploaded: ${remoteFilePath}`);

        await client.close();
    } catch (error) {
        console.error("FTP Upload Error:", error);
    }
}
//  export const generateEstimationPDF = async (req: Request, res: Response) => {
//     try {
//         const {
//             estimationId,
//             inclusions,
//             exclusions,
//             updateFields,
//         } = req.body;
//         console.log(estimationId, inclusions, exclusions)
//         const {
//             patientUHID,
//             patientName,
//             ageOfPatient,
//             genderOfPatient,
//             consultantName,
//             estimationPreferredDate,
//             estimationName,
//             icuStay,
//             wardStay,
//             totalDaysStay,
//             roomType,
//             estimatedDate,
//             discountPercentage,
//             estimationCost,
//             totalEstimationAmount,
//             patientSign,
//             employeeSign,
//             approverSign,
//             approverName,
//             employeeName,
//             patientPhoneNumber,
//             signatureOf,
//             implants,
//             procedures,
//             instrumentals,
//             surgeryPackage,
//             attenderName,
//             patientRemarks,
//             multipleEstimationCost,
//             costForGeneral,
//             costForPrivate,
//             costForSemiPrivate,
//             costForVip,
//             costForDeluxe,
//             costForPresidential,
//             selectedRoomCost,
//         } = updateFields

//         // Validate that estimationId is provided
//         if (!estimationId) {
//             res.status(400).json({ error: "Estimation ID is required" });
//             return;
//         }
//         // const pdfDirectory = path.join(__dirname, "../../generated_pdfs");
//         const pdfDirectory = "/home/u948610439/domains/inventionminds.com/public_html/docminds/pdfs";
//         // if (!fs.existsSync(pdfDirectory)) {
//         //     fs.mkdirSync(pdfDirectory, { recursive: true });
//         // }

//         // Sanitize the file name
//         const sanitizedEstimationId = estimationId.replace(/[\/\\:*?"<>|]/g, "_");
//         // const filePath = path.join(pdfDirectory, `Estimation_${sanitizedEstimationId}.pdf`);
//         const fileName = `Estimation_${sanitizedEstimationId}.pdf`;

//         // Temporary local file path (will be uploaded via FTP and deleted)
//         const tempFilePath = path.join(__dirname, fileName);
//         const doc = new PDFDocument({ size: "A4", margin: 20 });

//         // File to save the PDF

//         const writeStream = fs.createWriteStream(tempFilePath);

//         // Pipe the document to a file
//         doc.pipe(writeStream);

//         // Add background image (uploaded template)
//         const poppinsFontPath = path.join(__dirname, '../../assets/Poppins-Regular.ttf');
//         const poppinsMedium = path.join(__dirname, '../../assets/Poppins-Medium.ttf');
//         const poppinsSemiBold = path.join(__dirname, '../../assets/Poppins-SemiBold.ttf')

//         const templatePath = path.join(__dirname, '../../assets/JMRH Estimation Form.png');


//         // const templatePath = "E:/Hospital_Appointment_Admin_Panel_Backend/JMRH Estimation Form.png"; // Path to your uploaded PNG
//         if (fs.existsSync(templatePath)) {
//             doc.image(templatePath, 0, 0, { width: doc.page.width, height: doc.page.height });
//         } else {
//             console.warn(`Template file not found at: ${templatePath}`);
//         }

//         // Embed data into the form
//         // const poppinsFontPath = "E:/Hospital_Appointment_Admin_Panel_Backend/Poppins-Regular.ttf"; // Absolute path
//         // or if using relative paths:
//         // const poppinsFontPath = path.join(__dirname, "fonts", "Poppins-SemiBold.ttf");

//         // Register and use the font
//         doc.registerFont("Poppins-Regular", poppinsFontPath);

//         // const poppinsMedium = "E:/Hospital_Appointment_Admin_Panel_Backend/Poppins-Medium.ttf"
//         doc.registerFont("Poppins-Medium", poppinsMedium);
//         doc.registerFont("Poppins-SemiBold", poppinsSemiBold)

//         doc.fontSize(12).fillColor("black");

//         // Patient Information
//         doc.text(`${estimationId || "N/A"}`, 432, 88)
//         doc.font("Poppins-Regular").text(` ${patientUHID || "N/A"}`, 100, 126);
//         doc.text(`${patientName || "N/A"}`, 100, 150);
//         doc.text(`${ageOfPatient || "N/A"}`, 382, 126);
//         doc.text(` ${genderOfPatient || "N/A"}`, 380, 150);

//         // Consultant Information
//         doc.text(`${consultantName || "N/A"}`, 150, 196);
//         doc.text(` ${estimationPreferredDate || "N/A"}`, 422, 196);
//         doc.text(` ${estimationName || "N/A"}`, 148, 220);

//         // Stay Details
//         doc.text(` ${icuStay || "N/A"}`, 412, 248);
//         doc.text(`${wardStay || "N/A"}`, 540, 248);
//         doc.text(`${totalDaysStay || "N/A"}`, 306, 248);

//         // Room Type
//         // doc.fontSize(10).text(`Selected Ward: ${selectedRoomCost || "N/A"}`, 43, 270);
//         // Define available cost fields
//         const costFields = {
//             General: costForGeneral,
//             Private: costForPrivate,
//             SemiPrivate: costForSemiPrivate,
//             VIP: costForVip,
//             Deluxe: costForDeluxe,
//             Presidential: costForPresidential
//         };

//         // Example estimation names (split if there are multiple surgeries)
//         const estimationNames = estimationName ? estimationName.split(',') : [];

//         // Adjust initial position for displaying room costs
//         let yPosition = 290;
//         let index = 0; // Index for numbering room types

//         // // Iterate over available costs and format them correctly
//         // Object.entries(costFields).forEach(([key, value]) => {
//         //     if (value) {
//         //         const costs = value.split(','); // Split costs by comma
//         //         doc.text(`${index} - ${key}:`, 43, yPosition); // Print room type
//         //         yPosition += 15;

//         //         // Assign surgery names to each cost, if available
//         //         costs.forEach((cost:any, costIndex:any) => {
//         //             let surgeryLabel = estimationNames[costIndex] ? estimationNames[costIndex].trim() : `Cost ${costIndex + 1}`;
//         //             doc.text(`${surgeryLabel} cost: $${cost.trim()}`, 60, yPosition);
//         //             yPosition += 15; // Move to the next line
//         //         });

//         //         index++; // Increment index for room type numbering
//         //         yPosition += 5; // Extra spacing between room types
//         //     }
//         // });
//         // Iterate over available costs and format them correctly
// Object.entries(costFields).forEach(([key, value]) => {
//     if (value) {
//         const costs = value.split(','); // Split costs by comma

//         // Assign surgery names or default cost labels
//         const formattedCosts = costs.map((cost:any, costIndex:any) => {
//             let surgeryLabel = estimationNames[costIndex] ? estimationNames[costIndex].trim().trim().toUpperCase() : `Cost ${costIndex + 1}`;
//             return `${surgeryLabel} cost: ₹${cost.trim()}`;
//         });

//         doc.fillColor("#0098A3").font('Poppins-SemiBold').text(`${key}:`, 43, yPosition, { continued: false });

//         // Set font to semi-bold before printing surgery labels
//         doc.font('Poppins-SemiBold'); // Use a semi-bold font
//         doc.fillColor("black").text(formattedCosts.join(', '), 120, yPosition, { continued: false });
//         yPosition += 15; // Move to next line for the next room type

//         index++; // Increment index for room type numbering
//     }
// });



//         // doc.text(` ${costForGeneral || "N/A"}`, 43, 275);
//         doc.fontSize(8).font('Poppins-Regular').text(`Note: The cost of the room includes daily nursing and diet fees`, 43, 345);
//         doc.fillColor("#0098A3").font('Poppins-SemiBold').fontSize(14).text(`Inclusion: `, 30, 375);

//         // Inclusions & Exclusions
//         // doc.text(`${inclusions.length > 0 ? inclusions.map((i: any) => i.description).join(", ") : "None"}`, 50, 426);
//         // doc.text(` ${exclusions.length > 0 ? exclusions.map((e: any) => e.description).join(", ") : "None"}`, 50, 516);

//         const startX = 30;  // X position of first column
//         const columnWidth = 130; // Space between columns
//         const startY = 395;
//         const lineHeight = 20;
//         const columns = 4;
//         function formatWithSpaces(text: string): string {
//             return text.replace(/([a-z])([A-Z])/g, '$1 $2'); // Insert space before uppercase letters
//         }
//         // Split inclusions into 4 parts
//         const itemsPerColumn = Math.ceil(inclusions.length / columns);
//         const inclusionsColumns = [
//             inclusions.slice(0, itemsPerColumn),
//             inclusions.slice(itemsPerColumn, itemsPerColumn * 2),
//             inclusions.slice(itemsPerColumn * 2, itemsPerColumn * 3),
//             inclusions.slice(itemsPerColumn * 3)
//         ];
//         let num = 1
//         // Render inclusions in 4 columns
//         inclusionsColumns.forEach((column, colIndex) => {
//             column.forEach((item: string, rowIndex: number) => {
//                 if (item) { // Ensure item exists
//                     const xPos = startX + (colIndex * columnWidth);
//                     const yPos = startY + (rowIndex * lineHeight);
//                     const formattedItem = formatWithSpaces(item);

//                     doc.fontSize(10).fillColor("black").font('Poppins-Regular')
//                         .text(`${num}. ${formattedItem.charAt(0).toUpperCase() + formattedItem.slice(1)}`, xPos, yPos);

//                     num++; // Increment global number
//                 } else {
//                     console.warn("Skipping an invalid inclusion item:", item); // Log skipped items
//                 }
//             });
//         });

//         doc.fillColor("#0098A3").font('Poppins-SemiBold').fontSize(14).text(`Exclusions: `, 30, 455);

//         const startExclusionsY = 480;

//         // Split exclusions into 4 parts
//         const exclusionsPerColumn = Math.ceil(exclusions.length / columns);
//         const exclusionsColumns = [
//             exclusions.slice(0, exclusionsPerColumn),
//             exclusions.slice(exclusionsPerColumn, exclusionsPerColumn * 2),
//             exclusions.slice(exclusionsPerColumn * 2, exclusionsPerColumn * 3),
//             exclusions.slice(exclusionsPerColumn * 3)
//         ];

//         // Render exclusions in 4 columns
//         let exclusionNum = 1
//         exclusionsColumns.forEach((column, colIndex) => {
//             column.forEach((item: string, rowIndex: number) => {
//                 if (item) { // Ensure item exists

//                     const xPos = startX + (colIndex * columnWidth);
//                     const yPos = startExclusionsY + (rowIndex * lineHeight);
//                     const formattedItem = formatWithSpaces(item);

//                     doc.fontSize(10)
//                         .fillColor("black")
//                         .font('Poppins-Regular')
//                         .text(`${exclusionNum}. ${formattedItem.charAt(0).toUpperCase() + formattedItem.slice(1)}`, xPos, yPos);
//                     exclusionNum++;
//                 } else {
//                     console.warn("Skipping an invalid inclusion item:", item); // Log skipped items
//                 }
//             });
//         });
//         const itemsStartY = startExclusionsY + (exclusionsPerColumn + 2) * lineHeight;

//         doc.fontSize(12).text(`Implants: ${implants || "N/A"}`, 30, 547);
//         doc.fontSize(12).text(`Procedures: ${procedures || "N/A"}`, 30, 567);
//         doc.fontSize(12).text(`Instruments: ${instrumentals || "N/A"}`, 30, 589);
//         doc.fontSize(12).text(`Patient Remarks: ${patientRemarks || "N/A"}`, 30, 608)

//         // Set color for "Surgery Procedure:" label
//         // doc.fillColor("#0098A3").font('Poppins-SemiBold').text("Surgery Procedure: ", 30, 605, { continued: true });

//         // Reset color for the dynamic value (surgeryPackage)
//         // doc.fillColor("black").font("Poppins-Regular").fontSize(12).text(`${surgeryPackage || "N/A"}`);

//         if (surgeryPackage?.toLowerCase() === "multiple surgeries") {
//             doc.text(`Multiple Surgery Cost: ${multipleEstimationCost || "N/A"}`, 30, 625);
//         }
//         // Estimation Details
//         doc.text(`Estimated Date: ${estimatedDate || "N/A"}`, 30, 645);
//         // doc.text(`Discount: ${discountPercentage || ""}`, 300, 645);
//         doc.text(`Selected Ward: ${selectedRoomCost || "N/A"}`, 300, 645);
//         doc.fillColor("black").font('Poppins-SemiBold').fontSize(12).text(`Estimation Cost: ${estimationCost || 0}`, 30, 670);
//         doc.fillColor("black").font('Poppins-SemiBold').fontSize(12).text(`Total Cost: ${totalEstimationAmount || 0}`, 300, 670);

//         // Signatures
//         doc.fillColor("#213043").font("Poppins-Medium").text(`${signatureOf ? signatureOf.charAt(0).toUpperCase() + signatureOf.slice(1).toLowerCase() : "N/A"}`, 88, 696);


//         const addImageFromBase64 = async (
//             doc: PDFKit.PDFDocument,
//             base64: string,
//             x: number,
//             y: number,
//             width: number,
//             height: number
//         ) => {
//             try {
//                 if (base64.startsWith("data:image/png;base64,")) {
//                     // Decode Base64 and process it using sharp
//                     const imageBuffer = Buffer.from(base64.split(",")[1], "base64");

//                     // Ensure the image is a valid PNG using sharp
//                     const processedImageBuffer = await sharp(imageBuffer)
//                         .png()
//                         .toBuffer();

//                     // Create a temporary file (fallback for pdfkit)
//                     const tempFilePath = path.join(__dirname, `temp_${Date.now()}.png`);
//                     fs.writeFileSync(tempFilePath, processedImageBuffer);

//                     // Add the image to the PDF
//                     doc.image(tempFilePath, x, y, { width, height });

//                     // Clean up the temporary file
//                     fs.unlinkSync(tempFilePath);
//                 } else {
//                     console.error("Invalid Base64 image format");
//                     doc.text("Signature Missing", x, y + height / 2);
//                 }
//             } catch (error) {
//                 if (error instanceof Error) {
//                     console.error("Error adding image:", error.message);
//                 } else {
//                     console.error("Unknown error occurred.");
//                 }
//                 doc.text("Signature Missing", x, y + height / 2);
//             }
//         };

//         // Usage example in your PDF generation code
//         if (patientSign) {
//             await addImageFromBase64(doc, patientSign, 50, 715, 60, 30);
//         }
//         if (employeeSign) {
//             await addImageFromBase64(doc, employeeSign, 250, 715, 60, 30);
//         }
//         if (approverSign) {
//             await addImageFromBase64(doc, approverSign, 450, 715, 60, 30);
//         }

//         doc.text(`${signatureOf === "patient" ? patientName : attenderName || "N/A"}`, 55, 755)
//         doc.text(` ${employeeName || "N/A"}`, 244, 755);
//         doc.text(`${approverName || "N/A"}`, 440, 755);

//         // End the document
//         doc.end();

//         writeStream.on("finish", async () => {
//             const remoteFilePath = `/public_html/docminds/pdfs/${fileName}`;
//             await uploadToFTP(tempFilePath, remoteFilePath);
//             const pdfUrl = `https://docminds.inventionminds.com/pdfs/Estimation_${sanitizedEstimationId}.pdf`;

//             // Save PDF details to the database (assuming you have a function for this)
//             await savePdfToDatabase(estimationId, pdfUrl);

//             // Delete the local file after upload
//             fs.unlinkSync(tempFilePath);
//             const whatsappResponse = await sendWhatsAppMessage(patientPhoneNumber, pdfUrl, patientName, estimationId);

//             res.status(200).json({
//                 success: true,
//                 message: "PDF generated & sent via WhatsApp successfully.",
//                 filePath: pdfUrl,
//                 whatsappResponse: whatsappResponse.data // Include WhatsApp API response
//             });
//         });

//         writeStream.on("error", (error) => {
//             console.error("Error writing PDF:", error);
//             res.status(500).json({ error: "Failed to write PDF file." });
//         });
//     } catch (error) {
//         console.error("Error generating PDF:", error);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// };











export const generateEstimationPDF = async (req: Request, res: Response) => {
    try {
        const { estimationId, inclusions, exclusions, updateFields } = req.body;

        if (!estimationId) {
            res.status(400).json({ error: "Estimation ID is required" });
            return
        }
        const {
            patientUHID, patientName, ageOfPatient, genderOfPatient, consultantName,
            estimationPreferredDate, estimationName, icuStay, wardStay, totalDaysStay,
            estimatedDate, discountPercentage, estimationCost, totalEstimationAmount,
            patientSign, employeeSign, approverSign, approverName, employeeName,
            patientPhoneNumber, signatureOf, implants, procedures, instrumentals,
            surgeryPackage, attenderName, patientRemarks, multipleEstimationCost,
            costForGeneral, costForPrivate, costForSemiPrivate, costForVip,
            costForDeluxe, costForPresidential, selectedRoomCost, estimationCreatedTime,
            submittedDateAndTime
        } = updateFields;
        const sanitizedEstimationId = estimationId.replace(/[\/\\:*?"<>|]/g, "_");
        const fileName = `Estimation_${sanitizedEstimationId}.pdf`;
        const tempFilePath = path.join(__dirname, fileName);
        const doc = new PDFDocument({ size: "A4", margin: 30 });
        const writeStream = fs.createWriteStream(tempFilePath);
        doc.pipe(writeStream);

        const backgroundImagePath = path.join(__dirname, '../../assets/JMRH Estimation Form.png');
        const poppinsFontPath = path.join(__dirname, '../../assets/Poppins-Regular.ttf');
        const poppinsMedium = path.join(__dirname, '../../assets/Poppins-Medium.ttf');
        const poppinsSemiBold = path.join(__dirname, '../../assets/Poppins-SemiBold.ttf')

        doc.registerFont("PoppinsRegular", poppinsFontPath);
        doc.registerFont("PoppinsMedium", poppinsMedium);
        //         doc.registerFont("Poppins-Medium", poppinsMedium);
        doc.registerFont("PoppinsSemiBold", poppinsSemiBold)
        function addBackground(doc: any) {
            doc.image(backgroundImagePath, 0, 0, { width: 595, height: 842 });
            doc.y = 170; // Ensure text starts below header
        }

        function checkPageSpace(doc: any, additionalSpace = 0) {
            if (doc.y + additionalSpace > 700) {
                doc.addPage();
                addBackground(doc);
                addCreatedAtFooter(doc);
            }
        }
        function addCreatedAtFooter(doc: any) {
            const date = estimationPreferredDate ? new Date(estimationCreatedTime) : new Date(submittedDateAndTime);
            const createdAt = date.toLocaleDateString('en-GB', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });

            const text = `EST Created at: ${createdAt}`;
            const x = doc.page.width - 150;
            const y = doc.page.height - 30; // ✅ Safely away from margin

            // Use text with { continued: false, lineBreak: false } to avoid page break
            doc.save(); // Save current graphic state
            doc.fontSize(10)
                .fillColor('black')
                .font('PoppinsRegular')
                .text(text, x, y, { lineBreak: false });
            doc.restore(); // Restore original state
        }


        doc.on('pageAdded', () => {
            addBackground(doc);
            addCreatedAtFooter(doc);
        });

        addBackground(doc);
        addCreatedAtFooter(doc);

        // Position text inside background fields
        doc.fontSize(12).fillColor("black");

        doc.fillColor("#0098A3").font("PoppinsSemiBold").fontSize(18)
            .text(`ESTIMATION FORM`, 30, 90, { align: "left" });

        const estIdText = `EST.ID: ${estimationId || "N/A"}`;
        const estIdX = 380; // X-position
        const estIdY = 90;  // Y-position

        // Draw the text
        doc.fillColor("black").font("PoppinsRegular").fontSize(12).text(estIdText, estIdX, estIdY);


        const textWidth = doc.widthOfString(estIdText);
        const textHeight = doc.heightOfString(estIdText);

        // Draw underline
        doc.moveTo(estIdX, estIdY + textHeight + 2) // Start position (2px below the text)
            .lineTo(estIdX + textWidth, estIdY + textHeight + 2) // End position
            .stroke();


        doc.moveDown(0.5); // Add spacing


        doc.fillColor("#0098A3").font('PoppinsSemiBold').fontSize(14).text(`PATIENT INFORMATION:`, 30, 120);
        doc.fillColor("black").font("PoppinsRegular").fontSize(12);

        doc.text(`UHID:`, 30, 145);
        doc.text(`${patientUHID || "N/A"}`, 80, 145); // Positioning next to label

        doc.text(`NAME:`, 30, 165);
        doc.text(`${patientName.toUpperCase() || "N/A"}`, 80, 165);

        doc.text(`AGE:`, 300, 145);
        doc.text(`${ageOfPatient || "N/A"}`, 340, 145);

        doc.text(`GENDER:`, 300, 165);
        doc.text(`${genderOfPatient.toUpperCase() || "N/A"}`, 360, 165);

        // Consultant Information
        doc.fillColor("#0098A3").font('PoppinsSemiBold').fontSize(14).text(`CONSULTANT INFORMATION:`, 30, 190);
        doc.fillColor("black").font("PoppinsRegular").fontSize(12);

        doc.text(`DOCTOR NAME:`, 30, 215);
        doc.text(`${consultantName.toUpperCase() || "N/A"}`, 126, 215);
        const formattedPreferDate = estimationPreferredDate
            ? new Date(estimationPreferredDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : "N/A";
        console.log(formattedPreferDate)
        doc.text(`PREFERRED DATE:`, 300, 215);
        doc.text(`${formattedPreferDate || "N/A"}`, 400, 215);

        // doc.text(`ESTIMATION NAME:`, 30, 235);
        // doc.text(`${estimationName.toUpperCase() || "N/A"}`, 140, 235);
        // const EstimationProcedures = estimationName
        //     ? estimationName.split(',').map((p:any) => p.trim()).filter((p:any) => p)
        //     : [];
        // let startx = 140;
        // let starty = 235;
        // let rowHeight = 20;

        // // Table headers
        // doc.fontSize(10).text('No.', startx, starty);
        // doc.text('Procedure Name', startx + 40, starty);

        // // Draw rows
        // EstimationProcedures.forEach((procedure: any, index: any) => {
        //     const y = starty + rowHeight * (index + 1);
        //     doc.text(`${index + 1}`, startx, y);
        //     doc.text(procedure, startx + 40, y);
        // });

        const EstimationProcedures = estimationName
            ? estimationName.split(',').map((p: any) => p.trim()).filter((p: any) => p)
            : [];

        //   const startx = 140;
        let starty = 235;
        //   const col1Width = 30;
        //   const col2Width = 200;
        const docWidth = doc.page.width; // Typically 595.28 pt for A4
        const margin = 30;
        const usableWidth = docWidth - margin * 2;

        const startx = margin;
        const col1Width = 50;
        const col2Width = usableWidth - col1Width;
        const padding = 5;
        const lineheight = 12;

        // Draw Header
        doc.fillColor("#0098A3").fontSize(10).font('PoppinsSemiBold');
        doc.rect(startx, starty, col1Width, lineheight * 2).stroke();
        doc.rect(startx + col1Width, starty, col2Width, lineheight * 2).stroke();
        doc.text('No.', startx + padding, starty + padding);
        doc.text('Procedure Name', startx + col1Width + padding, starty + padding);

        doc.fillColor("black").font('PoppinsRegular');

        // Move to next row position
        let currentY = starty + lineheight * 2;

        EstimationProcedures.forEach((procedure: any, index: number) => {
            const wrappedTextHeight = doc.heightOfString(procedure, {
                width: col2Width - 2 * padding
            });

            const rowHeight = Math.max(lineheight, wrappedTextHeight + 2 * padding);

            // Draw cells
            doc.rect(startx, currentY, col1Width, rowHeight).stroke();
            doc.rect(startx + col1Width, currentY, col2Width, rowHeight).stroke();

            // Add text
            doc.text(`${index + 1}`, startx + padding, currentY + padding);
            doc.text(procedure, startx + col1Width + padding, currentY + padding, {
                width: col2Width - 2 * padding
            });

            currentY += rowHeight;
        });



        // Stay Details
        doc.fillColor("#0098A3").font('PoppinsSemiBold').fontSize(14).text(`EXPECTED NO. OF DAYS STAY:`, 30, doc.y + 20);
        doc.fillColor("black").font("PoppinsRegular").fontSize(12);

        const lineY = doc.y + 10;
        doc.text(`TOTAL NO. OF DAYS:`, 30, lineY);
        doc.text(`${totalDaysStay || "N/A"}`, 160, lineY);

        doc.text(`ICU STAY:`, 250, lineY);
        doc.text(`${icuStay || "N/A"}`, 320, lineY);

        doc.text(`WARD STAY:`, 400, lineY);
        doc.text(`${wardStay || "N/A"}`, 480, lineY);

        checkPageSpace(doc, 50);


        // const costFields = {
        //     General: costForGeneral,
        //     Private: costForPrivate,
        //     SemiPrivate: costForSemiPrivate,
        //     VIP: costForVip,
        //     Deluxe: costForDeluxe,
        //     Presidential: costForPresidential
        // };

        // // Example estimation names (split if there are multiple surgeries)
        // const estimationNames = estimationName ? estimationName.split(',') : [];

        // // Adjust initial position for displaying room costs
        // let yPosition = doc.y + 10;
        // let index = 0; // Index for numbering room types

        // Object.entries(costFields).forEach(([key, value]) => {
        //     if (value) {
        //         const costs = value.split(',');

        //         const formattedCosts = costs.map((cost: any, costIndex: any) => {
        //             let surgeryLabel = estimationNames[costIndex]?.trim()?.toUpperCase() || `Cost ${costIndex + 1}`;
        //             return `${surgeryLabel} COST: ₹${cost.trim()}`;
        //         });

        //         const labelText = `${key.toUpperCase()} WARD:`;
        //         const costText = formattedCosts.join(', ').toUpperCase();

        //         // Draw the ward label first
        //         doc.fillColor("#0098A3").font('PoppinsSemiBold').text(labelText, 43, yPosition, {
        //             continued: false
        //         });

        //         // Measure the height of the cost block before drawing
        //         const costHeight = doc.heightOfString(costText, {
        //             width: 350,
        //             lineGap: 4
        //         });

        //         // Draw the cost text with proper wrapping
        //         doc.font('PoppinsSemiBold').fillColor("black").text(costText, 180, yPosition, {
        //             width: 350,
        //             lineGap: 4
        //         });

        //         // ✅ Increase yPosition based on actual height
        //         yPosition += costHeight + 8;
        //     }
        // });


        // doc.text(` ${costForGeneral || "N/A"}`, 43, 275);
        // doc.fontSize(8).font('PoppinsRegular').text(`NOTE: THE COST OF THE ROOM INCLUDES DAILY NURSING`, 43, doc.y + 20);
        // Styled like second NOTE design

        const estimationNames = estimationName ? estimationName.split(',').map((n: any) => n.trim()) : [];

        const costFields = {
            General: costForGeneral,
            Private: costForPrivate,
            SemiPrivate: costForSemiPrivate,
            VIP: costForVip,
            Deluxe: costForDeluxe,
            Presidential: costForPresidential
        };

        const tableX = 43;
        let tableY = doc.y + 10;
        const colWidths = [30, 100, 200, 100]; // No., Room Type, Procedure Name, Cost

        // Header
        doc.fillColor("#0098A3").fontSize(10).font('PoppinsSemiBold');
        const headerHeight = 20;

        // Draw header boxes
        doc.rect(tableX, tableY, colWidths[0], headerHeight).stroke();
        doc.rect(tableX + colWidths[0], tableY, colWidths[1], headerHeight).stroke();
        doc.rect(tableX + colWidths[0] + colWidths[1], tableY, colWidths[2], headerHeight).stroke();
        doc.rect(tableX + colWidths[0] + colWidths[1] + colWidths[2], tableY, colWidths[3], headerHeight).stroke();

        // Header text
        doc.text('No.', tableX + padding, tableY + padding);
        doc.text('Room Type', tableX + colWidths[0] + padding, tableY + padding);
        doc.text('Procedure Name', tableX + colWidths[0] + colWidths[1] + padding, tableY + padding);
        doc.text('Cost (₹)', tableX + colWidths[0] + colWidths[1] + colWidths[2] + padding, tableY + padding);

        // Move to next row
        doc.fillColor("black").font('PoppinsRegular');
        let currenty = tableY + headerHeight;
        let serialNo = 1;

        Object.entries(costFields).forEach(([roomType, costValue]) => {
            if (costValue) {
                const costList = costValue.split(',').map((c: any) => c.trim());

                costList.forEach((cost: any, i: any) => {
                    const procedureName = estimationNames[i] || `Procedure`;

                    // Calculate the height required for the procedure name
                    const procedureHeight = doc.heightOfString(procedureName, {
                        width: colWidths[2] - 2 * padding
                    });

                    const rowHeight = Math.max(20, procedureHeight + 2 * padding);

                    // Draw row boxes
                    doc.rect(tableX, currenty, colWidths[0], rowHeight).stroke();
                    doc.rect(tableX + colWidths[0], currenty, colWidths[1], rowHeight).stroke();
                    doc.rect(tableX + colWidths[0] + colWidths[1], currenty, colWidths[2], rowHeight).stroke();
                    doc.rect(tableX + colWidths[0] + colWidths[1] + colWidths[2], currenty, colWidths[3], rowHeight).stroke();

                    // Text inside cells
                    doc.text(`${serialNo}`, tableX + padding, currenty + padding);
                    doc.text(roomType.toUpperCase(), tableX + colWidths[0] + padding, currenty + padding);
                    doc.text(procedureName.toUpperCase(), tableX + colWidths[0] + colWidths[1] + padding, currenty + padding, {
                        width: colWidths[2] - 2 * padding
                    });
                    doc.text(`₹${cost}`, tableX + colWidths[0] + colWidths[1] + colWidths[2] + padding, currenty + padding);

                    serialNo++;
                    currenty += rowHeight;
                });
            }
        });


        // const nursingNoteY = doc.y + 20;
        // doc.fillColor("#0098A3").font("PoppinsSemiBold").fontSize(10)
        //     .text("NOTE:", 43, nursingNoteY, { continued: true });

        // doc.fillColor("black").font("PoppinsRegular").fontSize(10)
        //     .text(" THE COST OF THE ROOM INCLUDES DAILY NURSING", { continued: false });

        // Move Y down to avoid overlap with next content
        doc.moveDown(1);


        // Update Y position
        doc.moveDown(1);


        let afterNoteY = doc.y;
        console.log('note', afterNoteY)
        doc.fillColor("#0098A3").font('PoppinsSemiBold').fontSize(14).text(`INCLUSION: `, 30, afterNoteY + 10);
        checkPageSpace(doc, 50);


        const startX = 30;  // X position of first column
        const columnWidth = 150; // Space between columns
        // const startY = 395;
        let afterRoomCostY = doc.y;
        console.log(afterRoomCostY)
        const startY = afterRoomCostY + 10; // Calculate height based on the text
        const lineHeight = 30;
        // const columns = 3;
        const processedInclusions: string[] = [];

        inclusions.forEach((item:any) => {
          if (!item) return;
        
          const formatted = formatWithSpaces(item).toUpperCase();
        
          if (formatted.includes("SURGEON OTANESTHESIA")) {
            processedInclusions.push("SURGEON & ASST. SURGEON", "OT", "ANESTHESIA");
          } else {
            processedInclusions.push(formatted);
          }
        });
        
        const totalInclusions = processedInclusions.length;
        const columns = 4;
        const itemsPer = Math.ceil(totalInclusions / columns);

        const inclusionColumns = Array.from({ length: columns }, (_, i) =>
            processedInclusions.slice(i * itemsPer, (i + 1) * itemsPer)
        );

        let inclusionCounter = 1;
        let maxInclusionY = startY;

        inclusionColumns.forEach((column, colIndex) => {
            column.forEach((item, rowIndex) => {
                const xPos = startX + colIndex * columnWidth;
                const yPos = startY + rowIndex * lineHeight;

                doc.fontSize(10)
                    .fillColor("black")
                    .font("PoppinsRegular")
                    .text(`${inclusionCounter}. ${item}`, xPos, yPos);

                if (yPos > maxInclusionY) maxInclusionY = yPos;
                inclusionCounter++;
            });
        });


        // const itemsPerColumn = Math.ceil(inclusions.length / columns);
        // const inclusionsColumns = [
        //     inclusions.slice(0, itemsPerColumn),
        //     inclusions.slice(itemsPerColumn, itemsPerColumn * 2),
        //     inclusions.slice(itemsPerColumn * 2, itemsPerColumn * 3),
        //     inclusions.slice(itemsPerColumn * 3)
        // ];
        // let num = 1
        // let maxInclusionY = startY; // Initialize with starting Y
        // inclusionsColumns.forEach((column, colIndex) => {
        //     column.forEach((item: string, rowIndex: number) => {
        //         if (item) {
        //             const xPos = startX + (colIndex * columnWidth);
        //             const yPos = startY + (rowIndex * lineHeight);
        //             const formattedItem = formatWithSpaces(item);

        //             doc.fontSize(10).fillColor("black").font('PoppinsRegular')
        //                 .text(`${num}. ${formattedItem.charAt(0).toUpperCase() + formattedItem.slice(1).toUpperCase()}`, xPos, yPos);

        //             if (yPos > maxInclusionY) maxInclusionY = yPos; // Track the deepest Y used
        //             num++;
        //         }
        //     });
        // });

        checkPageSpace(doc, 50);


        // doc.fillColor("#0098A3").font('PoppinsSemiBold').fontSize(14).text(`EXCLUSIONS: `, 30, doc.y + 10);
        // const exclusionHeaderY = maxInclusionY + lineHeight + 10;

        // doc.fillColor("black").font('PoppinsSemiBold').fontSize(12)
        // .text(`ESTIMATION COST: ${estimationCost || 0}`, 30, 80, { continued: false });

        // const nursingNoteY = doc.y + 20;
        // doc.fillColor("#0098A3").font("PoppinsSemiBold").fontSize(10)
        //     .text("NOTE:", 43, nursingNoteY, { continued: true });

        // doc.fillColor("black").font("PoppinsRegular").fontSize(10)
        //     .text(" THE COST OF THE ROOM INCLUDES DAILY NURSING", { continued: false });

        // checkPageSpace(doc, 50);

        // doc.fillColor("#0098A3").font('PoppinsSemiBold').fontSize(14).text(`EXCLUSIONS: `, 30, exclusionHeaderY + 10);
        // const startExclusionsY = doc.y + 5;

        checkPageSpace(doc, 50);  // Just after inclusion columns

        // Add ESTIMATION COST and NOTE section here
        doc.fillColor("black").font('PoppinsSemiBold').fontSize(12)
            .text(`ESTIMATION COST: ${selectedRoomCost || 0}`, 30,maxInclusionY + 20);

        const nursingNoteY = doc.y + 10;
        doc.fillColor("#0098A3").font("PoppinsSemiBold").fontSize(10)
            .text("NOTE:", 43, nursingNoteY, { continued: true });

        doc.fillColor("black").font("PoppinsRegular").fontSize(10)
            .text(" THE COST OF THE ROOM INCLUDES DAILY NURSING", { continued: false });

        // Then start exclusions
        const exclusionHeaderY = doc.y + 20;
        doc.fillColor("#0098A3").font('PoppinsSemiBold').fontSize(14)
            .text(`EXCLUSIONS: `, 30, exclusionHeaderY);


        const startExclusionsY = doc.y + 10;
        function formatWithSpaces(text: string): string {
            if (!text) return '';

            // Insert spaces before uppercase letters (CamelCase handling)
            let formattedText = text.replace(/([a-z])([A-Z])/g, '$1 $2');

            // Convert to uppercase to ensure case-insensitive replacements
            formattedText = formattedText.toUpperCase();

            // Define replacements for specific terms
            const replacements: { [key: string]: string } = {
                "LABORATORY IMAGING": "LABORATORY AND IMAGING",
                "WARD ICUSTAY": "WARD ICU STAY",
                // "SURGEON OTANESTHESIA": "SURGEON OT ANESTHESIA",
                "INSTRUMENT EQUIPMENT": "INSTRUMENTS",
                "BEDSIDE PROCEDURE": "ADD. PROCEDURE"
            };

            // Apply replacements
            Object.keys(replacements).forEach(key => {
                formattedText = formattedText.replace(new RegExp(key, 'gi'), replacements[key]);
            });

            return formattedText;
        }
        const processedExclusions: string[] = [];

        exclusions.forEach((item: string) => {
            const formattedItem = formatWithSpaces(item).toUpperCase();

            if (formattedItem.includes("SURGEON OTANESTHESIA")) {
                processedExclusions.push("SURGEON & ASST. SURGEON", "OT", "ANESTHESIA");
            } else {
                processedExclusions.push(formattedItem);
            }
        });
        // const columns = 3;
        const exclusionPer = Math.ceil(processedExclusions.length / columns);
        const exclusionColumns = Array.from({ length: columns }, (_, colIndex) =>
            processedExclusions.slice(colIndex * exclusionPer, (colIndex + 1) * exclusionPer)
        );
        let exclusionNum = 1;

        exclusionColumns.forEach((column, colIndex) => {
            column.forEach((item, rowIndex) => {
                const xPos = startX + (colIndex * columnWidth);
                const yPos = startExclusionsY + (rowIndex * lineHeight);

                doc.fontSize(10)
                    .fillColor("black")
                    .font("PoppinsRegular")
                    .text(`${exclusionNum}. ${item}`, xPos, yPos);

                exclusionNum++;
            });
        });


        // Split exclusions into 4 parts
        // const exclusionsPerColumn = Math.ceil(exclusions.length / columns);
        // const exclusionsColumns = [
        //     exclusions.slice(0, exclusionsPerColumn),
        //     exclusions.slice(exclusionsPerColumn, exclusionsPerColumn * 2),
        //     exclusions.slice(exclusionsPerColumn * 2, exclusionsPerColumn * 3),
        //     exclusions.slice(exclusionsPerColumn * 3)
        // ];

        // // Render exclusions in 4 columns
        // let exclusionNum = 1
        // exclusionsColumns.forEach((column, colIndex) => {
        //     column.forEach((item: string, rowIndex: number) => {
        //         if (item) {
        //             const xPos = startX + (colIndex * columnWidth);
        //             let yPos = startExclusionsY + (rowIndex * lineHeight);
        //             const formattedItem = formatWithSpaces(item);

        //             if (formattedItem.includes("SURGEON OTANESTHESIA")) {
        //                 const surgeonParts = [
        //                     "SURGEON & ASST. SURGEON",
        //                     "OT",
        //                     "ANESTHESIA"
        //                 ];

        //                 surgeonParts.forEach((subItem) => {
        //                     doc.fontSize(10)
        //                         .fillColor("black")
        //                         .font("PoppinsRegular")
        //                         .text(`${exclusionNum}. ${subItem}`, xPos, yPos);

        //                     exclusionNum++;
        //                     yPos += lineHeight;
        //                 });
        //             } else {
        //                 doc.fontSize(10)
        //                     .fillColor("black")
        //                     .font("PoppinsRegular")
        //                     .text(`${exclusionNum}. ${formattedItem.charAt(0).toUpperCase() + formattedItem.slice(1).toUpperCase()}`, xPos, yPos);
        //                 exclusionNum++;
        //             }
        //         } else {
        //             console.warn("Skipping an invalid exclusion item:", item);
        //         }
        //     });
        // });
        // exclusionsColumns.forEach((column, colIndex) => {
        //     column.forEach((item: string, rowIndex: number) => {
        //         if (item) { // Ensure item exists

        //             const xPos = startX + (colIndex * columnWidth);
        //             const yPos = startExclusionsY + (rowIndex * lineHeight);
        //             const formattedItem = formatWithSpaces(item);

        //             doc.fontSize(10)
        //                 .fillColor("black")
        //                 .font('PoppinsRegular')
        //                 .text(`${exclusionNum}. ${formattedItem.charAt(0).toUpperCase() + formattedItem.slice(1).toUpperCase()}`, xPos, yPos);
        //             exclusionNum++;
        //         } else {
        //             console.warn("Skipping an invalid inclusion item:", item); // Log skipped items
        //         }
        //     });
        // });
        // checkPageSpace(doc, 50);
        const itemsStartY = startExclusionsY + (exclusionPer + 2) * lineHeight;


        // let dynamicY = doc.y +20;

        let dynamicY = itemsStartY + 20; // Start below the exclusions section
        const labelX = 30;   // X position for labels
        const valueX = 160;  // X position for values (aligned for all)
        const maxWidth = 500; // Adjust width to avoid wrapping issues
        const valueWidth = 380;
        // Define label color & text properties
        const labelColor = "#0098A3"; // Highlight color
        const valueColor = "black";   // Default text color
        const labelFontSize = 14;
        const valueFontSize = 12;

        const formatValueString = (value: any) => {
            if (Array.isArray(value)) {
                return value.join(",  "); // ✅ Ensures double space after each comma
            }
            return (value || "N/A").replace(/,/g, ",  "); // ✅ Adds spaces after commas in strings
        };

        // Function to draw a label and aligned value in a single line
        const drawLabelValue = (label: any, value: any, yPosition: any) => {
            doc.fillColor(labelColor).font("PoppinsSemiBold").fontSize(labelFontSize).text(label, labelX, yPosition, { width: valueWidth });

            doc.fillColor(valueColor).font("PoppinsRegular").fontSize(valueFontSize)
                .text(` ${formatValueString(value)}`, valueX, yPosition, { width: valueWidth, align: "left" });
        };
        const requiredSpace = 100; // Approx space needed for implants + procedures + instruments + remarks
        const pageHeightThreshold = doc.page.height - 100;

        if (dynamicY + requiredSpace > pageHeightThreshold) {
            doc.addPage();
            dynamicY = 80; // Reset top padding for new page
        }

        // Draw content with perfect alignment and spacing
        drawLabelValue("IMPLANTS:", implants?.toUpperCase(), dynamicY);
        dynamicY += doc.heightOfString(formatValueString(implants).toUpperCase()) + 8; // Add spacing

        drawLabelValue("ADD. PROCEDURES:", procedures?.toUpperCase(), dynamicY);
        dynamicY += doc.heightOfString(formatValueString(procedures).toUpperCase()) + 8;

        drawLabelValue("INSTRUMENTS:", instrumentals?.toUpperCase(), dynamicY);
        dynamicY += doc.heightOfString(formatValueString(instrumentals).toUpperCase()) + 8;

        drawLabelValue("PATIENT REMARKS:", patientRemarks?.toUpperCase(), dynamicY);
        dynamicY += doc.heightOfString(formatValueString(patientRemarks).toUpperCase()) + 10;



        // if (surgeryPackage?.toLowerCase() === "multiple surgeries") {
        //     // doc.text(`Multiple Surgery Cost: ${multipleEstimationCost || "N/A"}`, 30, 625);
        //     doc.fontSize(12).text(`MULTIPLE SURGERY COST:  ${multipleEstimationCost || "N/A"}`, 30, dynamicY);
        //     dynamicY += doc.heightOfString(`MULTIPLE SURGERY COST:  ${multipleEstimationCost || "N/A"}`) + 10;
        // }

        if (dynamicY + requiredSpace > pageHeightThreshold) {
            doc.addPage();
            dynamicY = 80; // Reset top padding for new page
        }
        const formattedDate = estimatedDate
            ? new Date(estimatedDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : "N/A";
        doc.fillColor("black").font('PoppinsSemiBold').fontSize(12)
            .text(`ADMISSION DATE: ${formattedDate || "N/A"}`, 30, dynamicY + 20, { continued: false });

        // doc.fillColor("black").font('PoppinsSemiBold').fontSize(12)
        //     .text(`SELECTED WARD: ${selectedRoomCost.toUpperCase() || "N/A"}`, 300, dynamicY); // Same Y-coordinate

        // Now update dynamicY only once after both texts are placed
        dynamicY += doc.heightOfString(`ESTIMATED DATE: ${estimatedDate || "N/A"}`) + 10;

        if (dynamicY + requiredSpace > pageHeightThreshold) {
            doc.addPage();
            dynamicY = 80; // Reset top padding for new page
        }
        // Ensure space for cost details
        // checkPageSpace(doc, 50);

        // Cost Details (Bold & Dynamic)
        // doc.fillColor("black").font('PoppinsSemiBold').fontSize(12)
        //     .text(`ADDITIONAL COST: ${totalEstimationAmount - selectedRoomCost || 0}`, 30, dynamicY, { continued: false });
        const roomCostNumbers = (selectedRoomCost.match(/\d+/g) || []).map(Number);
        const summedRoomCost = roomCostNumbers.reduce((sum: any, num: any) => sum + num, 0);
        const additionalCost = totalEstimationAmount - summedRoomCost;

        // doc.fillColor("black").font('PoppinsSemiBold').fontSize(12)
        //     .text(`ADDITIONAL COST: ${additionalCost > 0 ? additionalCost : 0}`, 30, dynamicY, { continued: false });


        // doc.fillColor("black").font('PoppinsSemiBold').fontSize(12)
        //     .text(`TENTATIVE COST: ${totalEstimationAmount || 0}`, 300, dynamicY); // Same Y-coordinate
        const tablex = 30;
        let tabley = doc.y + 20;
        const colWidth = [200, 200]; // Label column and value column
        const rowHeight = 20;

        // Table rows
        const tableData = [
            ["INCLUSION ESTIMATION COST", `₹${summedRoomCost}`],
            ["ADDITIONAL COST", `₹${additionalCost > 0 ? additionalCost : 0}`],
            ["TENTATIVE COST", `₹${totalEstimationAmount}`],
        ];

        // Draw rows
        tableData.forEach(([label, value], index) => {
            const y = tabley + index * rowHeight;

            // Draw box for label
            doc.rect(tablex, y, colWidth[0], rowHeight).stroke();
            // Draw box for value
            doc.rect(tablex + colWidth[0], y, colWidth[1], rowHeight).stroke();

            // Add text
            doc.font("PoppinsSemiBold").fontSize(10).fillColor("black").text(label, tablex + 5, y + 5);
            doc.font("PoppinsRegular").text(value, tablex + colWidth[0] + 5, y + 5);
        });

        // Update Y position
        doc.y = tabley + tableData.length * rowHeight + 10;


        // Now update dynamicY only once after both texts are placed
        // dynamicY += doc.heightOfString(`ESTIMATION COST: ${estimationCost || 0}`) + 10;
        dynamicY = doc.y; // Add some space after the cost details


        const leftMargin = 30;   // Left-side margin
        const rightMargin = 50; // ✅ Reduce width to create right-side space
        const contentWidth = rightMargin - leftMargin; // Width of text with padding

        // Define note text
        const noteText = `This estimation is prepared based on the details available at the time of the request. 
Actual charges may vary depending on unforeseen circumstances or changes in the patient’s condition. 
The estimate is valid for 20 days from the date of issuance. Kindly contact our estimation team for a revised quote once the validity period has expired. 
Please note that the cost will increase if the duration of the patient’s stay exceeds the expected number of days.
Additional treatments may be suggested by the doctor, depending on the patient’s condition.`;

        // // Check if there's enough space before adding the note
        if (dynamicY + 150 > doc.page.height - 100) {
            doc.addPage();
            dynamicY = 80; // Reset Y position for new page
        }

        // Add "Note" title with proper margins
        doc.fillColor("#0098A3").font("PoppinsSemiBold").fontSize(10)
            .text("NOTE:", leftMargin, dynamicY, { continued: true });

        // Add the note content, ensuring right margin space
        doc.fillColor("black").font("PoppinsRegular").fontSize(10)
            .text(` ${noteText.toUpperCase()}`, 30, dynamicY, { width: 300, align: "left" });

        // Move Y position down after the note
        dynamicY += doc.heightOfString(noteText) + 15;

        // Ensure there's space before the signature section
        if (dynamicY + 150 > doc.page.height - 100) {
            doc.addPage();
            dynamicY = 50; // Reset Y position for new page
        }

        // Proceed with Signature Section
        const startYAxis = dynamicY + 20;
        const signerLabel = signatureOf === "patient" ? "SIGNATURE OF PATIENT" : "SIGNATURE OF ATTENDER";

        // Signature Titles with proper margins
        doc.fillColor("#213043").font("PoppinsSemiBold").fontSize(10);
        doc.text(signerLabel, leftMargin, startYAxis);
        doc.text("SIGNATURE OF STAFF", leftMargin + 200, startYAxis);
        doc.text("SIGNATURE OF APPROVER", leftMargin + 400, startYAxis);

        // Signature Boxes
        doc.rect(leftMargin, startYAxis + 20, 150, 50).stroke();  // Patient/Attender Box
        doc.rect(leftMargin + 200, startYAxis + 20, 150, 50).stroke(); // Staff Box
        doc.rect(leftMargin + 400, startYAxis + 20, 150, 50).stroke(); // Approver Box

        // Add Signatures (Base64 Images)
        await addImageFromBase64(doc, patientSign, leftMargin, startYAxis + 20, 140, 40, signerLabel);
        await addImageFromBase64(doc, employeeSign, leftMargin + 200, startYAxis + 20, 140, 40, "Staff Signature");
        await addImageFromBase64(doc, approverSign, leftMargin + 400, startYAxis + 20, 140, 40, "Approver Signature");

        // Add Names Below Signatures with proper spacing
        doc.fillColor("#000000").font("PoppinsRegular").fontSize(10);
        doc.text(signatureOf === "patient" ? patientName.toUpperCase() : attenderName.toUpperCase() || "N/A", leftMargin + 40, startYAxis + 85, { align: "left", width: 130, lineGap: 2 });
        doc.text(employeeName.toUpperCase() || "N/A", leftMargin + 240, startYAxis + 85, { align: "left", width: 130, lineGap: 2 });
        doc.text(approverName.toUpperCase() || "N/A", leftMargin + 440, startYAxis + 85, { align: "left", width: 130, lineGap: 2 });

        // Name Labels Below Names
        doc.font("PoppinsRegular").fontSize(10);
        doc.text("NAME :", leftMargin, startYAxis + 85);
        doc.text("NAME :", leftMargin + 200, startYAxis + 85);
        doc.text("NAME :", leftMargin + 400, startYAxis + 85);

        // // Line Under Name Labels
        // doc.moveTo(leftMargin + 40, startYAxis + 95).lineTo(leftMargin + 140, startYAxis + 95).stroke(); // Line under Patient/Attender
        // doc.moveTo(leftMargin + 240, startYAxis + 95).lineTo(leftMargin + 340, startYAxis + 95).stroke(); // Line under Staff
        // doc.moveTo(leftMargin + 440, startYAxis + 95).lineTo(leftMargin + 540, startYAxis + 95).stroke(); // Line under Approver

        // Move Down for Additional Content
        doc.moveDown(2);
        const declarationText = `I confirm that the admission details were explained to me clearly in a language I understand. I have understood the information and consent to proceed with admission and treatment as per hospital norms.`
        doc.fillColor("black").font("PoppinsRegular").fontSize(10)
            .text(` ${declarationText.toUpperCase()}`, 30, startYAxis + 120, { width: 520, align: "left" });

        // End PDF
        doc.end();


        writeStream.on("finish", async () => {
            // const remoteFilePath = `/public_html/docminds/pdfs/${fileName}`; // demo
            const remoteFilePath = `/public_html/docminds/demo_pdfs/${fileName}`; //rashtrotthana
            console.log(remoteFilePath);
            await uploadToFTP(tempFilePath, remoteFilePath);
            const pdfUrl = `https://docminds.inventionminds.com/demo_pdfs/Estimation_${sanitizedEstimationId}.pdf`;
            // const pdfUrl = `https://docminds.inventionminds.com/pdfs/Estimation_${sanitizedEstimationId}.pdf`;
            console.log(pdfUrl);

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


function drawTable(doc: any, rows: any, startX: any, startY: any) {
    rows.forEach(([label, value]: any, i: any) => {
        doc.font("Poppins-Bold").fontSize(10).text(label, startX, startY + i * 15);
        doc.font("Poppins-Regular").text(value, startX + 150, startY + i * 15);
    });
}

// 📌 Function to Add Images (Base64)
async function addImageFromBase64(doc: any, base64: any, x: any, y: any, width: any, height: any, label: any) {
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
        patientPhoneNumber = formatPhoneNumber(patientPhoneNumber);
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
function formatPhoneNumber(phoneNumber: string): string {
    phoneNumber = phoneNumber.replace(/\D/g, ''); // Remove non-numeric characters

    if (phoneNumber.length === 10) {
        return `91${phoneNumber}`; // ✅ Add country code if it's missing
    } else if (phoneNumber.length === 12 && phoneNumber.startsWith("91")) {
        return phoneNumber; // ✅ Keep as is
    } else {
        console.warn(`Invalid phone number format: ${phoneNumber}`);
        return phoneNumber; // Return unchanged if not valid
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
            const lockedUser = await prisma.user.findUnique({
                where: { id: estimation.lockedBy },
                select: { username: true },
            });

            const rawUsername = lockedUser?.username || 'Unknown User';

            // Regex to remove _admin, _subadmin, _superadmin, _doctor and everything after
            const displayName = rawUsername.split(/_(admin|subadmin|superadmin|doctor)/)[0];

            res.status(409).json({
                message: `Service is currently locked by ${displayName}`,
                lockedByUserId: estimation.lockedBy,
                lockedByUsername: displayName
            });
            return;
        }


        // If already locked by the same user, allow update (or skip updating if needed)
        if (estimation.lockedBy === userId) {
            res.status(200).json(estimation); // or skip update
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
export const updateSurgeryDate = async (req: Request, res: Response) => {
    try {
        const { estimationId } = req.params;
        const { statusOfEstimation, overDueDateAndTIme, estimatedDate } = req.body;

        if (!estimationId) {
            res.status(400).json({ message: 'Estimation ID is required' });
            return
        }

        const updatedEstimation = await prisma.estimationDetails.update({
            where: { estimationId: estimationId },
            data: {
                statusOfEstimation,
                overDueDateAndTIme, // this will be set to null as you pass it
                estimatedDate,
            }
        });

        res.status(200).json(updatedEstimation);
    } catch (error) {
        console.error('Error updating estimation:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
export const getFollowUpEstimations = async (req: Request, res: Response) => {
    try {
        const estimationFollowUpDetails = await prisma.estimationDetails.findMany({
            where: {
                followUpDates: {
                    some: {}
                }
            },
            include: {
                followUpDates: true
            }
        });

        res.status(200).json(estimationFollowUpDetails);
    } catch (error) {
        console.error('Error fetching estimation details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export const getTodayConfirmedEstimations = async (req: Request, res: Response) => {
    try {
        const confirmedEstimations = await prisma.estimationDetails.findMany({
            where: {
                statusOfEstimation: 'confirmed',
            },
            select: {
                id: true,
                patientName: true,
                estimationId: true,
                confirmedDateAndTime: true,
                statusOfEstimation: true,
                estimationStatus: true,
                estimationType: true
            }
        })
        res.status(200).json(confirmedEstimations)
    }
    catch (error) {
        console.error('Error fetching estimation details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export const getopdEstimation = async (req: Request, res: Response) => {
    try {
        const confirmedEstimations = await prisma.estimationDetails.findMany({
            where: {
                estimationCreatedTime: {
                    not: null
                }
            },
            select: {
                id: true,
                patientName: true,
                estimationId: true,
                statusOfEstimation: true,
                estimationStatus: true,
                estimationType: true,
                estimationCreatedTime: true,
                patientUHID: true,
                consultantId: true,
            }
        })
        res.status(200).json(confirmedEstimations)
    }
    catch (error) {
        console.error('Error fetching estimation details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export const getStatusEstimation = async (req: Request, res: Response) => {
    try {
        const confirmedEstimations = await prisma.estimationDetails.findMany({
            select: {
                id: true,
                patientName: true,
                estimationId: true,
                statusOfEstimation: true,
                estimationType: true,
                estimationCreatedTime: true,
                patientUHID: true,
                consultantId: true,
                approvedDateAndTime: true,
                confirmedDateAndTime: true,
                cancellationDateAndTime: true,
                completedDateAndTime: true,
                overDueDateAndTIme: true,
                submittedDateAndTime: true,
            }
        })
        res.status(200).json(confirmedEstimations)
    }
    catch (error) {
        console.error('Error fetching estimation details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}