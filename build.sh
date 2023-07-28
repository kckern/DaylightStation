
# DST is $1 or "docker" if not set
DST=${1:-docker}
DOCKER_USER=kckern


cd backend
LOCALREPO=daylight-station:latest 
REMOTEREPO=daylight-station-ecr-test:latest

#docker build . -t $DOCKER_USER/$REPO



# IF DST IS AWS, PUSH TO AWS ELSE PUSH TO DOCKER

if [ "$DST" == "aws" ]
then
    echo "Pushing to AWS"

    #PREPARE AWS
    AWS_ACCOUNT_ID=558021760172
    AWS_REGION=us-west-2
    AWS_PATH="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
    AWS_PASSWORD=$(aws ecr get-login-password --region $AWS_REGION)

    #CHECK IF REPO EXISTS
    REPOEXISTS=$(aws ecr describe-repositories --repository-names $REMOTEREPO)
    if [ -z "$REPOEXISTS" ]
    then
        echo "Creating Repo"
        aws ecr create-repository --repository-name $REMOTEREPO
    else
        echo "Repo exists"
    fi

    echo "Tagging : $DOCKER_USER/$LOCALREPO to $AWS_PATH/$REMOTEREPO"
    docker tag $DOCKER_USER/$LOCALREPO $AWS_PATH/$REMOTEREPO

    #LOGIN TO AWS
    docker login --username AWS --password-stdin $AWS_PATH <<< $AWS_PASSWORD


    #PUSH TO AWS
    echo "Pushing to AWS: $AWS_PATH/$REMOTEREPO"
    docker -D push $AWS_PATH/$REMOTEREPO

    ## GET THE ECS Service to pull the new image
    #aws ecs update-service --cluster home --service home-backend --force-new-deployment



else
    echo "Pushing to Docker"
   # docker push $DOCKER_USER/$REPO
fi

