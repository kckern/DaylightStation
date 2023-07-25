
# DST is $1 or "docker" if not set
DST=${1:-docker}
DOCKER_USER=kckern


cd backend
REPO=daylight-station-backend
docker build . -t $DOCKER_USER/$REPO


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
    REPOEXISTS=$(aws ecr describe-repositories --repository-names $REPO)
    if [ -z "$REPOEXISTS" ]
    then
        echo "Repo does not exist"
        aws ecr create-repository --repository-name $REPO
    else
        echo "Repo exists"
    fi

    docker tag $DOCKER_USER/$REPO $AWS_PATH/$REPO

    #LOGIN TO AWS
    docker login --username AWS --password-stdin $AWS_PATH <<< $AWS_PASSWORD


    #PUSH TO AWS
    docker -D push $AWS_PATH/$REPO

    ## GET THE ECS Service to pull the new image
    aws ecs update-service --cluster home --service home-backend --force-new-deployment



else
    echo "Pushing to Docker"
    docker push $DOCKER_USER/$REPO
fi

