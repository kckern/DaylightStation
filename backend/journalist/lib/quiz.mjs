import { answerQuizQuestion, deleteMessageFromDB, loadUnsentQueue, saveMessage, updateDBMessage, updateQueue } from "./db.mjs";
import { slashCommand } from "./journalist.mjs";
import { deleteSpecificMessage, updateMessage } from "./telegram.mjs"


export const handleQuizAnswer = async (chatId, { queue_uuid, messageId, value, quizKey}) => {

    if(queue_uuid){
        await updateQueue(queue_uuid, messageId);
        await answerQuizQuestion(quizKey, value);
    }

    //load the next question from queue, if any
    const [nextQuestion] = await loadUnsentQueue(chatId);
    const foreign_key = nextQuestion?.foreign_key || {};
    const isQuiz = !!foreign_key?.quiz;


    if(!isQuiz){
        await deleteSpecificMessage(chatId, messageId);
        return await slashCommand(chatId, 'journal');
    }

    const update = {
        message_id: messageId, 
        text: nextQuestion.queued_message, 
        choices: nextQuestion.choices, 
        inline: nextQuestion.inline
    };

    foreign_key['queue'] = nextQuestion.uuid;
    
    await updateMessage(chatId, update);
    await updateDBMessage(chatId, messageId, 
        {text: nextQuestion.queued_message, foreign_key});


}